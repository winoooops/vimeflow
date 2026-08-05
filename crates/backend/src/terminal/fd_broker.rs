//! Rust side of the PTY winsize-ownership protocol (VIM-399 Phase 2).
//!
//! The broker owns the lease table: one active lease per session, allocated
//! fresh on every fd transfer. It offers duplicated PTY master descriptors to
//! the native addon over the [`fd_transport`](super::fd_transport) channel and
//! answers the addon's ownership messages. Design (verbatim protocol):
//! docs/superpowers/specs/2026-07-28-pty-winsize-atomicity.md
//!
//! Wire format: one JSON object per datagram.
//!
//! Rust → addon: `fd` (carries the descriptor), `activate-ack`,
//! `release-ack`, `detach`.
//! addon → Rust: `native-ready`, `release`, `request-fd`.
//!
//! Ownership rules implemented here:
//! - `native_owned` is set on `native-ready` and cleared on the FIRST
//!   `release` receipt or transport loss — never by ack delivery, so a lost
//!   ack can only extend the duplicate window, never create a gap.
//! - Every `release` receipt is acked (idempotent retry convergence); the
//!   size is applied only when the lease is still the active one.
//! - A `request-fd` while the previous lease is not yet retired is deferred
//!   and answered on retirement (release receipt or transport loss).

#![cfg(unix)]

use std::collections::HashMap;
use std::os::fd::{AsRawFd, OwnedFd, RawFd};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use super::fd_transport;
use super::state::PtyState;
use super::types::SessionId;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
enum WireMessage {
    /// Rust → addon; the datagram additionally carries the descriptor.
    Fd {
        #[serde(rename = "sessionId")]
        session_id: String,
        generation: u64,
        #[serde(rename = "leaseId")]
        lease_id: u64,
    },
    NativeReady {
        #[serde(rename = "sessionId")]
        session_id: String,
        generation: u64,
        #[serde(rename = "leaseId")]
        lease_id: u64,
        role: String,
    },
    ActivateAck {
        #[serde(rename = "sessionId")]
        session_id: String,
        generation: u64,
        #[serde(rename = "leaseId")]
        lease_id: u64,
    },
    Release {
        #[serde(rename = "sessionId")]
        session_id: String,
        generation: u64,
        #[serde(rename = "leaseId")]
        lease_id: u64,
        rows: u16,
        cols: u16,
    },
    ReleaseAck {
        #[serde(rename = "sessionId")]
        session_id: String,
        generation: u64,
        #[serde(rename = "leaseId")]
        lease_id: u64,
    },
    RequestFd {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Ping,
    Detach {
        #[serde(rename = "sessionId")]
        session_id: String,
        generation: u64,
        #[serde(rename = "leaseId")]
        lease_id: u64,
    },
}

/// The active lease for one session. At most one per session; a new transfer
/// always allocates a fresh `lease_id` so a delayed message from an old
/// binding can never affect its replacement.
#[derive(Debug, Clone)]
struct Lease {
    lease_id: u64,
    generation: u64,
    native_owned: bool,
}

#[derive(Default)]
struct BrokerInner {
    leases: HashMap<SessionId, Lease>,
    /// Sessions whose `request-fd` is deferred until the previous lease
    /// retires (release receipt or transport loss), stamped with the
    /// generation that owned the active lease when the request arrived.
    deferred_requests: HashMap<SessionId, u64>,
    next_lease_id: u64,
}

/// Rust-side protocol endpoint. Lives for the process lifetime once
/// installed into [`PtyState`].
pub struct FdBroker {
    transport_fd: RawFd,
    inner: Mutex<BrokerInner>,
}

impl FdBroker {
    /// Creates the broker and spawns its blocking read loop. `transport_fd`
    /// is the claimed stdio\[3\] end (see `fd_transport::claim_inherited_transport`).
    pub fn start(transport_fd: RawFd, pty: PtyState) -> Option<Arc<Self>> {
        let broker = Arc::new(Self {
            transport_fd,
            inner: Mutex::new(BrokerInner::default()),
        });
        let reader = Arc::clone(&broker);
        if let Err(err) = std::thread::Builder::new()
            .name("pty-fd-broker".into())
            .spawn(move || reader.read_loop(pty))
        {
            log::warn!(
                "fd broker: failed to spawn broker thread ({err}); staying on async resize path"
            );
            return None;
        }
        Some(broker)
    }

    /// Whether the native side currently owns the winsize ioctl for this
    /// session. `PtyState::resize` consults it to skip the duplicate ioctl
    /// (Phase 4 single-writer rule).
    pub fn is_native_owned(&self, session_id: &str, generation: u64) -> bool {
        let inner = self.inner.lock().expect("broker lock");
        inner
            .leases
            .get(session_id)
            .is_some_and(|l| l.generation == generation && l.native_owned)
    }

    /// Offers a duplicated PTY master to the addon under a fresh lease.
    /// Called on session spawn and on deferred `request-fd` fulfillment.
    /// A failure leaves the session `RUST_OWNED` — never worse than today.
    pub fn offer_fd(&self, session_id: &str, generation: u64, master_fd: OwnedFd) {
        let (lease_id, retired) = {
            let mut inner = self.inner.lock().expect("broker lock");
            inner.next_lease_id += 1;
            let lease_id = inner.next_lease_id;
            inner.deferred_requests.remove(session_id);
            let retired = inner.leases.insert(
                session_id.to_string(),
                Lease {
                    lease_id,
                    generation,
                    native_owned: false,
                },
            );
            (lease_id, retired)
        };

        if let Some(retired) = retired {
            self.send(&WireMessage::Detach {
                session_id: session_id.to_string(),
                generation: retired.generation,
                lease_id: retired.lease_id,
            });
        }

        let msg = WireMessage::Fd {
            session_id: session_id.to_string(),
            generation,
            lease_id,
        };
        let payload = serde_json::to_vec(&msg).expect("serialize fd message");
        let result = fd_transport::send_fd(self.transport_fd, &payload, master_fd.as_raw_fd());
        // The kernel holds its own in-flight reference; our owned dup closes
        // at scope exit either way because send_fd does not take ownership.
        if let Err(err) = result {
            log::warn!("fd broker: send failed for {session_id} ({err}); reclaiming");
            let mut inner = self.inner.lock().expect("broker lock");
            inner.remove_lease_if_matches(session_id, lease_id);
        }
    }

    /// Session exited: retire its lease and tell the addon to drop any
    /// binding or pending entry. Exit cleanup rides the transport
    /// exclusively — never the generationless `pty-exit` renderer event.
    pub fn on_session_exit(&self, session_id: &str, generation: u64) {
        let lease = {
            let mut inner = self.inner.lock().expect("broker lock");
            match inner.leases.get(session_id) {
                Some(l) if l.generation == generation => {
                    inner.remove_deferred_if_generation_matches(session_id, generation);
                    inner.leases.remove(session_id)
                }
                _ => None,
            }
        };
        if let Some(lease) = lease {
            self.send(&WireMessage::Detach {
                session_id: session_id.to_string(),
                generation,
                lease_id: lease.lease_id,
            });
        }
    }

    fn send(&self, msg: &WireMessage) {
        let payload = serde_json::to_vec(msg).expect("serialize wire message");
        if let Err(err) = fd_transport::send_datagram(self.transport_fd, &payload) {
            log::warn!("fd broker: send failed ({err})");
        }
    }

    fn read_loop(self: Arc<Self>, pty: PtyState) {
        let mut buf = [0u8; fd_transport::MAX_MESSAGE_BYTES];
        loop {
            // Poll with a timeout instead of blocking in recvmsg: on macOS a
            // BLOCKED recv on a DGRAM socketpair is never woken by peer
            // close — only a fresh poll observes the ECONNRESET. The timeout
            // bounds how long a dead transport can go unnoticed.
            let received = match fd_transport::recv_fd_timeout(
                self.transport_fd,
                &mut buf,
                std::time::Duration::from_millis(500),
            ) {
                Ok(Some(result)) => result,
                Ok(None) => {
                    if self.has_leases() && self.probe_transport().is_err() {
                        log::warn!("fd broker: transport probe failed; reclaiming all leases");
                        self.reclaim_all();
                        return;
                    }
                    continue;
                }
                Err(err) => {
                    log::warn!("fd broker: transport error ({err}); reclaiming all leases");
                    self.reclaim_all();
                    return;
                }
            };
            let (len, fd) = received;
            // The addon never sends descriptors; drop any that arrive.
            drop(fd);
            if len == 0 {
                log::info!("fd broker: transport EOF; reclaiming all leases");
                self.reclaim_all();
                return;
            }
            match serde_json::from_slice::<WireMessage>(&buf[..len]) {
                Ok(msg) => self.handle(msg, &pty),
                Err(err) => log::warn!("fd broker: bad message ({err})"),
            }
        }
    }

    /// Transport loss: every session returns to `RUST_OWNED` immediately —
    /// the addon closes its side unilaterally, Rust resumes ioctling.
    fn reclaim_all(&self) {
        let mut inner = self.inner.lock().expect("broker lock");
        inner.leases.clear();
        inner.deferred_requests.clear();
    }

    fn has_leases(&self) -> bool {
        !self.inner.lock().expect("broker lock").leases.is_empty()
    }

    fn probe_transport(&self) -> std::io::Result<()> {
        let payload = serde_json::to_vec(&WireMessage::Ping).expect("serialize ping message");
        fd_transport::send_datagram(self.transport_fd, &payload)
    }

    fn handle(&self, msg: WireMessage, pty: &PtyState) {
        match msg {
            WireMessage::NativeReady {
                session_id,
                generation,
                lease_id,
                role: _,
            } => {
                let acked = {
                    let mut inner = self.inner.lock().expect("broker lock");
                    match inner.leases.get_mut(&session_id) {
                        Some(l) if l.lease_id == lease_id && l.generation == generation => {
                            l.native_owned = true;
                            true
                        }
                        // Stale lease/generation: drop. native-ready is not
                        // retried; a loss only extends the duplicate window.
                        _ => false,
                    }
                };
                if acked {
                    // The positive signal Phase 5's "confirm the native
                    // path is live" check greps for — silent degradation
                    // must never be mistaken for a working handshake.
                    log::info!(
                        "fd broker: native owns winsize for {session_id} (gen {generation}, lease {lease_id})"
                    );
                    self.send(&WireMessage::ActivateAck {
                        session_id,
                        generation,
                        lease_id,
                    });
                }
            }
            WireMessage::Release {
                session_id,
                generation,
                lease_id,
                rows,
                cols,
            } => {
                let apply = {
                    let mut inner = self.inner.lock().expect("broker lock");
                    match inner.leases.get(&session_id) {
                        Some(l) if l.lease_id == lease_id && l.generation == generation => {
                            // First receipt retires the lease; ownership
                            // returns to Rust BEFORE the size is applied.
                            inner.leases.remove(&session_id);
                            true
                        }
                        // Duplicate retry of an already-retired lease, or a
                        // stale lease from before a remount: ack (retry
                        // convergence) but never apply an obsolete size.
                        _ => false,
                    }
                };
                if apply {
                    log::info!(
                        "fd broker: rust reacquired winsize for {session_id} (lease {lease_id}, {cols}x{rows})"
                    );
                    if rows > 0 && cols > 0 {
                        if let Err(err) = pty.resize(&session_id, rows, cols) {
                            log::warn!("fd broker: release resize failed for {session_id} ({err})");
                        }
                    } else {
                        log::debug!(
                            "fd broker: release for {session_id} carried no recorded native size"
                        );
                    }
                }
                self.send(&WireMessage::ReleaseAck {
                    session_id: session_id.clone(),
                    generation,
                    lease_id,
                });
                if apply {
                    self.fulfill_deferred(&session_id, generation, pty);
                }
            }
            WireMessage::RequestFd { session_id } => {
                let answer_now = {
                    let mut inner = self.inner.lock().expect("broker lock");
                    if let Some(lease) = inner.leases.get(&session_id) {
                        // Serialize re-acquisition: answered on retirement.
                        let generation = lease.generation;
                        inner
                            .deferred_requests
                            .insert(session_id.clone(), generation);
                        false
                    } else {
                        true
                    }
                };
                if answer_now {
                    self.answer_request(&session_id, pty);
                }
            }
            // Rust never receives its own outbound message kinds.
            WireMessage::Fd { .. }
            | WireMessage::Ping
            | WireMessage::ActivateAck { .. }
            | WireMessage::ReleaseAck { .. }
            | WireMessage::Detach { .. } => {}
        }
    }

    fn fulfill_deferred(&self, session_id: &str, generation: u64, pty: &PtyState) {
        let deferred = {
            let mut inner = self.inner.lock().expect("broker lock");
            inner.remove_deferred_if_generation_matches(session_id, generation)
        };
        if deferred {
            self.answer_request(session_id, pty);
        }
    }

    fn answer_request(&self, session_id: &str, pty: &PtyState) {
        match pty.master_fd_duplicate_and_generation(session_id) {
            Some((master_fd, generation)) => self.offer_fd(session_id, generation, master_fd),
            None => log::warn!("fd broker: request-fd for unknown session {session_id}"),
        }
    }
}

impl BrokerInner {
    fn remove_lease_if_matches(&mut self, session_id: &str, lease_id: u64) {
        if self
            .leases
            .get(session_id)
            .is_some_and(|lease| lease.lease_id == lease_id)
        {
            self.leases.remove(session_id);
        }
    }

    fn remove_deferred_if_generation_matches(&mut self, session_id: &str, generation: u64) -> bool {
        if self
            .deferred_requests
            .get(session_id)
            .is_some_and(|deferred_generation| *deferred_generation == generation)
        {
            self.deferred_requests.remove(session_id);
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
    use std::time::{Duration, Instant};

    struct AddonSim {
        fd: OwnedFd,
    }

    impl AddonSim {
        fn send(&self, msg: &WireMessage) {
            let payload = serde_json::to_vec(msg).expect("serialize");
            fd_transport::send_datagram(self.fd.as_raw_fd(), &payload).expect("send");
        }

        /// Receives one datagram with a deadline (the broker thread answers
        /// asynchronously).
        fn recv(&self) -> WireMessage {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut buf = [0u8; fd_transport::MAX_MESSAGE_BYTES];
            loop {
                assert!(Instant::now() < deadline, "timed out waiting for message");
                match fd_transport::recv_fd_timeout(
                    self.fd.as_raw_fd(),
                    &mut buf,
                    Duration::from_millis(200),
                ) {
                    Ok(Some((len, _fd))) => {
                        return serde_json::from_slice(&buf[..len]).expect("parse")
                    }
                    Ok(None) => {}
                    Err(err) => panic!("recv failed: {err}"),
                }
            }
        }
    }

    fn start_broker() -> (Arc<FdBroker>, AddonSim, PtyState) {
        let (rust_end, addon_end) = fd_transport::socketpair().expect("socketpair");
        let pty = PtyState::default();
        let broker =
            FdBroker::start(rust_end.as_raw_fd(), pty.clone()).expect("broker should start");
        // The broker does not own rust_end; keep it alive for the test.
        std::mem::forget(rust_end);
        (broker, AddonSim { fd: addon_end }, pty)
    }

    fn probe_fd() -> OwnedFd {
        let (a, _b) = fd_transport::socketpair().expect("probe fds");
        std::mem::forget(_b);
        a
    }

    fn duplicate_fd(fd: RawFd) -> OwnedFd {
        // SAFETY: F_DUPFD_CLOEXEC returns a new fd owned by this test helper.
        let dup = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 0) };
        assert!(dup >= 0, "failed to duplicate fd");

        unsafe { OwnedFd::from_raw_fd(dup) }
    }

    struct PtySessionCleanup {
        pty_state: PtyState,
        session_id: String,
    }

    impl Drop for PtySessionCleanup {
        fn drop(&mut self) {
            if let Some(mut session) = self.pty_state.remove(&self.session_id) {
                let _ = session.child.kill();
                let _ = session.child.wait();
            }
        }
    }

    #[test]
    fn test_offer_fd_allocates_fresh_lease_and_sends_descriptor() {
        let (broker, addon, _pty) = start_broker();
        let probe = probe_fd();

        broker.offer_fd("s1", 7, duplicate_fd(probe.as_raw_fd()));
        let msg = addon.recv();
        match msg {
            WireMessage::Fd {
                session_id,
                generation,
                lease_id,
            } => {
                assert_eq!(session_id, "s1");
                assert_eq!(generation, 7);
                assert_eq!(lease_id, 1);
            }
            other => panic!("expected fd message, got {other:?}"),
        }

        broker.offer_fd("s1", 7, duplicate_fd(probe.as_raw_fd()));
        match addon.recv() {
            WireMessage::Detach { lease_id, .. } => assert_eq!(lease_id, 1),
            other => panic!("expected detach message, got {other:?}"),
        }
        match addon.recv() {
            WireMessage::Fd { lease_id, .. } => assert_eq!(lease_id, 2, "lease must be fresh"),
            other => panic!("expected fd message, got {other:?}"),
        }
    }

    #[test]
    fn test_offer_fd_detaches_retired_lease_before_replacement() {
        let (broker, addon, _pty) = start_broker();
        let probe = probe_fd();

        broker.offer_fd("s1", 3, duplicate_fd(probe.as_raw_fd()));
        match addon.recv() {
            WireMessage::Fd { lease_id, .. } => assert_eq!(lease_id, 1),
            other => panic!("expected fd message, got {other:?}"),
        }

        broker.offer_fd("s1", 4, duplicate_fd(probe.as_raw_fd()));
        match addon.recv() {
            WireMessage::Detach {
                generation,
                lease_id,
                ..
            } => {
                assert_eq!(generation, 3);
                assert_eq!(lease_id, 1);
            }
            other => panic!("expected detach for retired lease, got {other:?}"),
        }
        match addon.recv() {
            WireMessage::Fd {
                generation,
                lease_id,
                ..
            } => {
                assert_eq!(generation, 4);
                assert_eq!(lease_id, 2);
            }
            other => panic!("expected replacement fd message, got {other:?}"),
        }
    }

    #[test]
    fn test_failed_offer_cleanup_preserves_newer_lease() {
        let mut inner = BrokerInner::default();
        inner.leases.insert(
            "s1".to_string(),
            Lease {
                lease_id: 2,
                generation: 7,
                native_owned: true,
            },
        );

        inner.remove_lease_if_matches("s1", 1);

        assert!(
            inner.leases.contains_key("s1"),
            "failed cleanup for stale lease must preserve replacement"
        );

        inner.remove_lease_if_matches("s1", 2);

        assert!(
            !inner.leases.contains_key("s1"),
            "failed cleanup for current lease should reclaim the entry"
        );
    }

    #[test]
    fn test_native_ready_sets_ownership_and_acks() {
        let (broker, addon, _pty) = start_broker();
        let probe = probe_fd();
        broker.offer_fd("s1", 3, duplicate_fd(probe.as_raw_fd()));
        let _ = addon.recv();

        assert!(!broker.is_native_owned("s1", 3));
        addon.send(&WireMessage::NativeReady {
            session_id: "s1".into(),
            generation: 3,
            lease_id: 1,
            role: "primary".into(),
        });
        match addon.recv() {
            WireMessage::ActivateAck { lease_id, .. } => assert_eq!(lease_id, 1),
            other => panic!("expected activate-ack, got {other:?}"),
        }
        assert!(broker.is_native_owned("s1", 3));
    }

    #[test]
    fn test_stale_native_ready_is_dropped_without_ownership() {
        let (broker, addon, _pty) = start_broker();
        let probe = probe_fd();
        broker.offer_fd("s1", 3, duplicate_fd(probe.as_raw_fd()));
        let _ = addon.recv();
        // Remount: a second transfer supersedes lease 1.
        broker.offer_fd("s1", 3, duplicate_fd(probe.as_raw_fd()));
        let _ = addon.recv();

        addon.send(&WireMessage::NativeReady {
            session_id: "s1".into(),
            generation: 3,
            lease_id: 1,
            role: "primary".into(),
        });
        // Give the broker a beat, then confirm the stale lease bought nothing.
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            !broker.is_native_owned("s1", 3),
            "stale native-ready must not grant ownership"
        );
    }

    #[test]
    fn test_release_retires_lease_acks_and_survives_duplicates() {
        let (broker, addon, _pty) = start_broker();
        let probe = probe_fd();
        broker.offer_fd("s1", 3, duplicate_fd(probe.as_raw_fd()));
        let _ = addon.recv();
        addon.send(&WireMessage::NativeReady {
            session_id: "s1".into(),
            generation: 3,
            lease_id: 1,
            role: "primary".into(),
        });
        let _ = addon.recv();
        assert!(broker.is_native_owned("s1", 3));

        let release = WireMessage::Release {
            session_id: "s1".into(),
            generation: 3,
            lease_id: 1,
            rows: 31,
            cols: 97,
        };
        addon.send(&release);
        match addon.recv() {
            WireMessage::ReleaseAck { lease_id, .. } => assert_eq!(lease_id, 1),
            other => panic!("expected release-ack, got {other:?}"),
        }
        assert!(
            !broker.is_native_owned("s1", 3),
            "release returns ownership"
        );

        // Idempotent retry: acked again, ownership unchanged.
        addon.send(&release);
        match addon.recv() {
            WireMessage::ReleaseAck { lease_id, .. } => assert_eq!(lease_id, 1),
            other => panic!("expected release-ack again, got {other:?}"),
        }
        assert!(!broker.is_native_owned("s1", 3));
    }

    #[test]
    fn test_stale_release_from_old_lease_cannot_affect_replacement() {
        let (broker, addon, _pty) = start_broker();
        let probe = probe_fd();
        broker.offer_fd("s1", 3, duplicate_fd(probe.as_raw_fd()));
        let _ = addon.recv();
        // Same-generation remount: fresh lease 2 replaces lease 1.
        broker.offer_fd("s1", 3, duplicate_fd(probe.as_raw_fd()));
        let _ = addon.recv();
        let _ = addon.recv();
        addon.send(&WireMessage::NativeReady {
            session_id: "s1".into(),
            generation: 3,
            lease_id: 2,
            role: "primary".into(),
        });
        let _ = addon.recv();
        assert!(broker.is_native_owned("s1", 3));

        // Delayed release from the OLD binding: acked (retry convergence)
        // but the replacement's ownership must survive.
        addon.send(&WireMessage::Release {
            session_id: "s1".into(),
            generation: 3,
            lease_id: 1,
            rows: 24,
            cols: 80,
        });
        match addon.recv() {
            WireMessage::ReleaseAck { lease_id, .. } => assert_eq!(lease_id, 1),
            other => panic!("expected release-ack, got {other:?}"),
        }
        assert!(
            broker.is_native_owned("s1", 3),
            "stale release must not clear the replacement lease"
        );
    }

    #[test]
    fn test_request_fd_deferred_until_previous_lease_retires() {
        let (broker, addon, _pty) = start_broker();
        let probe = probe_fd();
        broker.offer_fd("s1", 3, duplicate_fd(probe.as_raw_fd()));
        let _ = addon.recv();

        // Previous lease still active: request must NOT be answered yet.
        addon.send(&WireMessage::RequestFd {
            session_id: "s1".into(),
        });
        std::thread::sleep(Duration::from_millis(100));

        // Retire lease 1; the deferred request now needs a live session to
        // dup from — PtyState has none, so the broker logs and stays quiet.
        // The serialization behavior itself is what this test pins: no fd
        // message may arrive between the request and the retirement.
        addon.send(&WireMessage::Release {
            session_id: "s1".into(),
            generation: 3,
            lease_id: 1,
            rows: 24,
            cols: 80,
        });
        match addon.recv() {
            WireMessage::ReleaseAck { .. } => {}
            WireMessage::Fd { .. } => {
                panic!("request-fd must not be answered before the previous lease retires")
            }
            other => panic!("unexpected message {other:?}"),
        }
    }

    #[test]
    fn test_detach_sent_for_matching_generation_only() {
        let (broker, addon, _pty) = start_broker();
        let probe = probe_fd();
        broker.offer_fd("s1", 3, duplicate_fd(probe.as_raw_fd()));
        let _ = addon.recv();

        // Delayed exit from an older generation: no detach for lease 1.
        broker.on_session_exit("s1", 2);
        assert!(broker.inner.lock().unwrap().leases.contains_key("s1"));

        broker.on_session_exit("s1", 3);
        match addon.recv() {
            WireMessage::Detach {
                generation,
                lease_id,
                ..
            } => {
                assert_eq!(generation, 3);
                assert_eq!(lease_id, 1);
            }
            other => panic!("expected detach, got {other:?}"),
        }
        assert!(!broker.inner.lock().unwrap().leases.contains_key("s1"));
    }

    #[test]
    fn test_stale_exit_preserves_current_generation_deferred_request() {
        let (broker, addon, _pty) = start_broker();
        let probe = probe_fd();
        broker.offer_fd("s1", 3, duplicate_fd(probe.as_raw_fd()));
        let _ = addon.recv();

        addon.send(&WireMessage::RequestFd {
            session_id: "s1".into(),
        });
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(
            broker
                .inner
                .lock()
                .unwrap()
                .deferred_requests
                .get("s1")
                .copied(),
            Some(3)
        );

        broker.on_session_exit("s1", 2);
        assert_eq!(
            broker
                .inner
                .lock()
                .unwrap()
                .deferred_requests
                .get("s1")
                .copied(),
            Some(3),
            "stale exit must not clear a deferred request for the current generation"
        );

        broker.on_session_exit("s1", 3);
        assert!(
            !broker
                .inner
                .lock()
                .unwrap()
                .deferred_requests
                .contains_key("s1"),
            "matching exit should clear the deferred request"
        );
    }

    #[test]
    fn test_resize_is_metadata_only_while_native_owned() {
        use portable_pty::{native_pty_system, PtySize};

        let (rust_end, addon_end) = fd_transport::socketpair().expect("socketpair");
        let pty_state = PtyState::default();
        let broker =
            FdBroker::start(rust_end.as_raw_fd(), pty_state.clone()).expect("broker should start");
        pty_state.set_fd_broker(Arc::clone(&broker));
        std::mem::forget(rust_end);
        let addon = AddonSim { fd: addon_end };

        // Real PTY session so resize() has a live master to (not) ioctl.
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");
        let mut cmd = portable_pty::CommandBuilder::new("/bin/sh");
        cmd.args(["-c", "while :; do sleep 0.1; done"]);
        let child = pair.slave.spawn_command(cmd).expect("spawn");
        let writer = pair.master.take_writer().expect("writer");
        let generation = pty_state.next_generation();
        pty_state.insert(
            "s1".to_string(),
            crate::terminal::state::ManagedSession {
                master: pair.master,
                writer,
                child,
                cwd: "/".into(),
                bridge_dir: None,
                shim_dir: None,
                generation,
                ring: Arc::new(Mutex::new(crate::terminal::state::RingBuffer::new(1024))),
                cancelled: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                started_at: std::time::SystemTime::now(),
            },
        );
        let _cleanup = PtySessionCleanup {
            pty_state: pty_state.clone(),
            session_id: "s1".to_string(),
        };

        let (fd, generation) = pty_state
            .master_fd_duplicate_and_generation("s1")
            .expect("master fd");
        broker.offer_fd("s1", generation, fd);
        let lease_id = match addon.recv() {
            WireMessage::Fd { lease_id, .. } => lease_id,
            other => panic!("expected fd, got {other:?}"),
        };
        addon.send(&WireMessage::NativeReady {
            session_id: "s1".into(),
            generation,
            lease_id,
            role: "primary".into(),
        });
        let _ = addon.recv();
        assert!(broker.is_native_owned("s1", generation));

        // Native-owned: the resize is metadata only — the PTY keeps 80x24.
        pty_state.resize(&"s1".to_string(), 31, 97).expect("resize");
        let size = pty_state
            .master_size("s1")
            .expect("size while native-owned");
        assert_eq!((size.rows, size.cols), (24, 80), "ioctl must be skipped");

        // Release returns ownership; the release size applies, and later
        // resizes ioctl again.
        addon.send(&WireMessage::Release {
            session_id: "s1".into(),
            generation,
            lease_id,
            rows: 31,
            cols: 97,
        });
        let _ = addon.recv();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let size = pty_state.master_size("s1").expect("size after release");
            if (size.rows, size.cols) == (31, 97) {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "release size must be applied once Rust reacquires"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        pty_state
            .resize(&"s1".to_string(), 40, 120)
            .expect("resize");
        let size = pty_state.master_size("s1").expect("size rust-owned");
        assert_eq!((size.rows, size.cols), (40, 120), "rust writes again");
    }

    #[test]
    fn test_transport_eof_reclaims_all_leases() {
        let (rust_end, addon_end) = fd_transport::socketpair().expect("socketpair");
        let pty = PtyState::default();
        let broker = FdBroker::start(rust_end.as_raw_fd(), pty).expect("broker should start");
        std::mem::forget(rust_end);
        let probe = probe_fd();
        broker.offer_fd("s1", 3, duplicate_fd(probe.as_raw_fd()));

        {
            let addon = AddonSim { fd: addon_end };
            let _ = addon.recv();
            addon.send(&WireMessage::NativeReady {
                session_id: "s1".into(),
                generation: 3,
                lease_id: 1,
                role: "primary".into(),
            });
            let _ = addon.recv();
            assert!(broker.is_native_owned("s1", 3));
            // AddonSim drops here: the addon end closes → broker sees EOF.
        }

        let deadline = Instant::now() + Duration::from_secs(5);
        while broker.is_native_owned("s1", 3) {
            assert!(
                Instant::now() < deadline,
                "transport loss must reclaim ownership"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}
