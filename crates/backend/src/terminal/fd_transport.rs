//! SCM_RIGHTS fd passing for the PTY winsize-atomicity transport (VIM-399).
//!
//! The Electron main process holds one end of an `AF_UNIX`/`SOCK_DGRAM`
//! socketpair (created by the native addon before the sidecar spawns); the
//! sidecar inherits the other end as fd 3. Rust sends duplicated PTY master
//! descriptors over it so the addon can apply `TIOCSWINSZ` synchronously at
//! the engine resize callback. Datagram sockets preserve message boundaries,
//! so every `sendmsg` is exactly one protocol message with at most one fd.
//!
//! Design: docs/superpowers/specs/2026-07-28-pty-winsize-atomicity.md

#![cfg(unix)]

use std::io;
use std::os::fd::{FromRawFd, OwnedFd, RawFd};

/// The stdio slot the Electron parent uses for the transport socketpair.
pub const TRANSPORT_FD: RawFd = 3;

/// Env var the Electron parent sets when (and only when) it passed the
/// transport as fd 3. Absent → feature unavailable, stay on the async path.
pub const TRANSPORT_ENV: &str = "VIMEFLOW_PTY_FD_TRANSPORT";

/// Maximum payload bytes per transport message (one JSON header).
pub const MAX_MESSAGE_BYTES: usize = 4096;

const CMSG_CAPACITY: usize = 64; // >= CMSG_SPACE(sizeof(int)) on macOS/Linux

#[repr(C)]
struct ControlMessageBuffer {
    bytes: [u8; CMSG_CAPACITY],
    _align: [libc::cmsghdr; 0],
}

impl ControlMessageBuffer {
    fn zeroed() -> Self {
        Self {
            bytes: [0u8; CMSG_CAPACITY],
            _align: [],
        }
    }

    fn as_mut_ptr(&mut self) -> *mut libc::c_void {
        self.bytes.as_mut_ptr().cast()
    }
}

fn last_error() -> io::Error {
    io::Error::last_os_error()
}

fn validate_payload(payload: &[u8]) -> io::Result<()> {
    if payload.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "fd transport payload cannot be empty",
        ));
    }
    if payload.len() > MAX_MESSAGE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "fd transport payload is {} bytes; max is {}",
                payload.len(),
                MAX_MESSAGE_BYTES
            ),
        ));
    }

    Ok(())
}

/// Sets `FD_CLOEXEC` so the descriptor never leaks into exec'd children.
///
/// Inheriting via `stdio[3]` clears close-on-exec, and the backend spawns
/// many ordinary subprocesses — this must run before any of them can spawn.
pub fn set_cloexec(fd: RawFd) -> io::Result<()> {
    // SAFETY: fcntl on a caller-supplied fd; no memory is shared.
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
    if flags < 0 {
        return Err(last_error());
    }
    if unsafe { libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) } < 0 {
        Err(last_error())
    } else {
        Ok(())
    }
}

/// Claims the inherited transport end at sidecar bootstrap: verifies fd 3 is
/// open and marks it close-on-exec. Returns the fd, or `None` when the
/// parent did not pass a transport (env unset or fd invalid).
pub fn claim_inherited_transport() -> Option<RawFd> {
    std::env::var_os(TRANSPORT_ENV)?;
    match set_cloexec(TRANSPORT_FD) {
        Ok(()) => Some(TRANSPORT_FD),
        Err(err) => {
            log::warn!("pty fd transport: fd {TRANSPORT_FD} unusable ({err}); staying on async resize path");
            None
        }
    }
}

/// Sends `payload` plus one duplicated file descriptor as a single datagram.
///
/// The kernel installs its own reference to `fd` in flight, so the caller
/// keeps ownership of its copy regardless of when the receiver reads.
pub fn send_fd(channel: RawFd, payload: &[u8], fd: RawFd) -> io::Result<()> {
    validate_payload(payload)?;

    let mut iov = libc::iovec {
        iov_base: payload.as_ptr() as *mut libc::c_void,
        iov_len: payload.len(),
    };

    let mut cmsg_buf = ControlMessageBuffer::zeroed();
    // SAFETY: CMSG_SPACE is a pure size computation for one RawFd payload.
    let cmsg_space = unsafe { libc::CMSG_SPACE(std::mem::size_of::<RawFd>() as u32) } as usize;
    assert!(cmsg_space <= CMSG_CAPACITY);

    // SAFETY: msghdr is a C POD out-struct; every field used below is assigned
    // before sendmsg observes it.
    let mut msg: libc::msghdr = unsafe { std::mem::zeroed() };
    msg.msg_iov = &mut iov;
    msg.msg_iovlen = 1;
    msg.msg_control = cmsg_buf.as_mut_ptr();
    msg.msg_controllen = cmsg_space as _;

    // SAFETY: cmsg_buf outlives msg; CMSG_FIRSTHDR is non-null because
    // msg_controllen covers one cmsghdr.
    unsafe {
        let cmsg = libc::CMSG_FIRSTHDR(&msg);
        (*cmsg).cmsg_level = libc::SOL_SOCKET;
        (*cmsg).cmsg_type = libc::SCM_RIGHTS;
        (*cmsg).cmsg_len = libc::CMSG_LEN(std::mem::size_of::<RawFd>() as u32) as _;
        std::ptr::copy_nonoverlapping(
            &fd as *const RawFd as *const u8,
            libc::CMSG_DATA(cmsg),
            std::mem::size_of::<RawFd>(),
        );
    }

    loop {
        // SAFETY: msg and its buffers are valid for the duration of the call.
        let sent = unsafe { libc::sendmsg(channel, &msg, 0) };
        if sent >= 0 {
            return Ok(());
        }
        let err = last_error();
        if err.kind() != io::ErrorKind::Interrupted {
            return Err(err);
        }
    }
}

/// Sends a plain datagram (no descriptor) — the ack/control messages of the
/// ownership protocol.
pub fn send_datagram(channel: RawFd, payload: &[u8]) -> io::Result<()> {
    validate_payload(payload)?;
    loop {
        // SAFETY: payload is a valid buffer for the duration of the call.
        let sent = unsafe {
            libc::send(
                channel,
                payload.as_ptr() as *const libc::c_void,
                payload.len(),
                0,
            )
        };
        if sent >= 0 {
            return Ok(());
        }
        let err = last_error();
        if err.kind() != io::ErrorKind::Interrupted {
            return Err(err);
        }
    }
}

/// [`recv_fd`] with a poll timeout. Returns `Ok(None)` when nothing arrived
/// within `timeout` — used by tests and by receivers that must also service
/// retries.
pub fn recv_fd_timeout(
    channel: RawFd,
    buf: &mut [u8],
    timeout: std::time::Duration,
) -> io::Result<Option<(usize, Option<OwnedFd>)>> {
    let mut pollfd = libc::pollfd {
        fd: channel,
        events: libc::POLLIN,
        revents: 0,
    };
    let millis = timeout.as_millis().min(i32::MAX as u128) as libc::c_int;
    // SAFETY: pollfd is a valid out-struct for the duration of the call.
    let ready = unsafe { libc::poll(&mut pollfd, 1, millis) };
    if ready < 0 {
        let err = last_error();
        if err.kind() == io::ErrorKind::Interrupted {
            return Ok(None);
        }
        return Err(err);
    }
    if ready == 0 {
        return Ok(None);
    }
    if pollfd.revents & libc::POLLIN == 0 {
        if pollfd.revents & (libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0 {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "fd transport peer closed",
            ));
        }
        return Ok(None);
    }
    recv_fd(channel, buf).map(Some)
}

/// Receives one datagram: the payload bytes and, when present, the passed
/// descriptor. The fd is marked `FD_CLOEXEC` immediately — sender-side
/// close-on-exec does not transfer — and returned as an `OwnedFd` (RAII, so
/// never-bound descriptors cannot leak).
pub fn recv_fd(channel: RawFd, buf: &mut [u8]) -> io::Result<(usize, Option<OwnedFd>)> {
    assert!(!buf.is_empty());

    let mut iov = libc::iovec {
        iov_base: buf.as_mut_ptr() as *mut libc::c_void,
        iov_len: buf.len(),
    };

    let mut cmsg_buf = ControlMessageBuffer::zeroed();

    // SAFETY: msghdr is a C POD out-struct; every field used below is assigned
    // before recvmsg observes it, and recvmsg fills the remaining output fields.
    let mut msg: libc::msghdr = unsafe { std::mem::zeroed() };
    msg.msg_iov = &mut iov;
    msg.msg_iovlen = 1;
    msg.msg_control = cmsg_buf.as_mut_ptr();
    msg.msg_controllen = CMSG_CAPACITY as _;

    let received = loop {
        // SAFETY: msg and its buffers are valid for the duration of the call.
        let n = unsafe { libc::recvmsg(channel, &mut msg, 0) };
        if n >= 0 {
            break n as usize;
        }
        let err = last_error();
        if err.kind() != io::ErrorKind::Interrupted {
            return Err(err);
        }
    };

    let control_truncated = msg.msg_flags & libc::MSG_CTRUNC != 0;
    let mut fd: Option<OwnedFd> = None;
    // SAFETY: the kernel wrote msg_controllen bytes of cmsg data into
    // cmsg_buf; CMSG_FIRSTHDR/CMSG_NXTHDR walk only that region.
    unsafe {
        let mut cmsg = libc::CMSG_FIRSTHDR(&msg);
        while !cmsg.is_null() {
            if (*cmsg).cmsg_level == libc::SOL_SOCKET && (*cmsg).cmsg_type == libc::SCM_RIGHTS {
                let expected_len = libc::CMSG_LEN(std::mem::size_of::<RawFd>() as u32) as usize;
                if (*cmsg).cmsg_len as usize != expected_len {
                    close_rights_cmsg_fds(cmsg);
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "fd transport expected exactly one descriptor",
                    ));
                }

                let mut raw: RawFd = -1;
                std::ptr::copy_nonoverlapping(
                    libc::CMSG_DATA(cmsg),
                    &mut raw as *mut RawFd as *mut u8,
                    std::mem::size_of::<RawFd>(),
                );
                if raw >= 0 {
                    if fd.is_some() {
                        libc::close(raw);
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidData,
                            "fd transport received duplicate descriptor headers",
                        ));
                    }
                    let owned = OwnedFd::from_raw_fd(raw);
                    set_cloexec(raw)?;
                    fd = Some(owned);
                }
            }
            cmsg = libc::CMSG_NXTHDR(&msg, cmsg);
        }
    }

    if control_truncated {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "fd transport control data was truncated",
        ));
    }

    Ok((received, fd))
}

/// Closes every descriptor carried by an `SCM_RIGHTS` control message.
///
/// # Safety
///
/// `cmsg` must be a non-null pointer returned by `CMSG_FIRSTHDR` or
/// `CMSG_NXTHDR` for the current `recvmsg` result. Its `cmsg_len` must describe
/// initialized kernel-written control data in the backing control buffer.
unsafe fn close_rights_cmsg_fds(cmsg: *mut libc::cmsghdr) {
    let header_len = libc::CMSG_LEN(0) as usize;
    let cmsg_len = (*cmsg).cmsg_len as usize;
    if cmsg_len <= header_len {
        return;
    }

    let fd_count = (cmsg_len - header_len) / std::mem::size_of::<RawFd>();
    for index in 0..fd_count {
        let mut raw: RawFd = -1;
        std::ptr::copy_nonoverlapping(
            libc::CMSG_DATA(cmsg).add(index * std::mem::size_of::<RawFd>()),
            &mut raw as *mut RawFd as *mut u8,
            std::mem::size_of::<RawFd>(),
        );
        if raw >= 0 {
            libc::close(raw);
        }
    }
}

/// Creates a connected `AF_UNIX`/`SOCK_DGRAM` pair, both ends close-on-exec.
/// Test/support helper mirroring what the native addon does before spawn.
pub fn socketpair() -> io::Result<(OwnedFd, OwnedFd)> {
    let mut fds = [-1 as RawFd; 2];
    // SAFETY: fds is a valid out-array of two ints.
    if unsafe { libc::socketpair(libc::AF_UNIX, libc::SOCK_DGRAM, 0, fds.as_mut_ptr()) } < 0 {
        return Err(last_error());
    }
    // SAFETY: the kernel just returned these fds; we own them.
    let (a, b) = unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) };
    set_cloexec(fds[0])?;
    set_cloexec(fds[1])?;
    Ok((a, b))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::align_of;
    use std::os::fd::AsRawFd;

    #[test]
    fn test_control_message_buffer_is_cmsghdr_aligned() {
        let mut cmsg_buf = ControlMessageBuffer::zeroed();
        let address = cmsg_buf.as_mut_ptr() as usize;

        assert_eq!(address % align_of::<libc::cmsghdr>(), 0);
    }

    #[test]
    fn test_send_fd_round_trips_payload_and_descriptor() {
        let (tx, rx) = socketpair().expect("socketpair");
        let (dup_a, dup_b) = socketpair().expect("payload fds");

        send_fd(tx.as_raw_fd(), b"hello", dup_a.as_raw_fd()).expect("send");

        let mut buf = [0u8; 64];
        let (n, fd) = recv_fd(rx.as_raw_fd(), &mut buf).expect("recv");
        assert_eq!(&buf[..n], b"hello");
        let fd = fd.expect("descriptor should arrive");

        // The received copy is live: writing through it reaches dup_b.
        // SAFETY: fd/dup_b are open sockets owned by this test.
        let wrote = unsafe { libc::write(fd.as_raw_fd(), b"x".as_ptr() as *const _, 1) };
        assert_eq!(wrote, 1);
        let mut byte = [0u8; 1];
        let read = unsafe { libc::read(dup_b.as_raw_fd(), byte.as_mut_ptr() as *mut _, 1) };
        assert_eq!(read, 1);
        assert_eq!(byte[0], b'x');
    }

    #[test]
    fn test_recv_fd_marks_received_descriptor_cloexec() {
        let (tx, rx) = socketpair().expect("socketpair");
        let (payload_fd, _keep) = socketpair().expect("payload fds");

        send_fd(tx.as_raw_fd(), b"m", payload_fd.as_raw_fd()).expect("send");
        let mut buf = [0u8; 8];
        let (_, fd) = recv_fd(rx.as_raw_fd(), &mut buf).expect("recv");
        let fd = fd.expect("fd");

        let flags = unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_GETFD) };
        assert!(flags >= 0);
        assert_ne!(flags & libc::FD_CLOEXEC, 0, "received fd must be cloexec");
    }

    #[test]
    fn test_recv_fd_without_descriptor_returns_none() {
        let (tx, rx) = socketpair().expect("socketpair");
        // Plain datagram, no cmsg.
        // SAFETY: tx is an open socket and the byte pointer is valid for the
        // duration of this write call.
        let sent = unsafe { libc::write(tx.as_raw_fd(), b"nd".as_ptr() as *const _, 2) };
        assert_eq!(sent, 2);

        let mut buf = [0u8; 8];
        let (n, fd) = recv_fd(rx.as_raw_fd(), &mut buf).expect("recv");
        assert_eq!(&buf[..n], b"nd");
        assert!(fd.is_none());
    }

    #[test]
    fn test_recv_fd_rejects_multi_descriptor_cmsg() {
        let (tx, rx) = socketpair().expect("socketpair");
        let (fd_a, fd_b) = socketpair().expect("payload fds");
        let mut payload = [b'x'];
        let mut iov = libc::iovec {
            iov_base: payload.as_mut_ptr().cast(),
            iov_len: payload.len(),
        };
        let mut cmsg_buf = ControlMessageBuffer::zeroed();
        // SAFETY: CMSG_SPACE is a pure size computation for two RawFd payloads.
        let cmsg_space =
            unsafe { libc::CMSG_SPACE((std::mem::size_of::<RawFd>() * 2) as u32) } as usize;
        assert!(cmsg_space <= CMSG_CAPACITY);
        // SAFETY: msghdr is a C POD out-struct; every field used below is
        // assigned before sendmsg observes it.
        let mut msg: libc::msghdr = unsafe { std::mem::zeroed() };
        msg.msg_iov = &mut iov;
        msg.msg_iovlen = 1;
        msg.msg_control = cmsg_buf.as_mut_ptr();
        msg.msg_controllen = cmsg_space as _;

        // SAFETY: cmsg_buf outlives msg; the control buffer has enough capacity
        // for two RawFd values and both source descriptors are open.
        unsafe {
            let cmsg = libc::CMSG_FIRSTHDR(&msg);
            (*cmsg).cmsg_level = libc::SOL_SOCKET;
            (*cmsg).cmsg_type = libc::SCM_RIGHTS;
            (*cmsg).cmsg_len = libc::CMSG_LEN((std::mem::size_of::<RawFd>() * 2) as u32) as _;
            let fds = [fd_a.as_raw_fd(), fd_b.as_raw_fd()];
            std::ptr::copy_nonoverlapping(
                fds.as_ptr().cast::<u8>(),
                libc::CMSG_DATA(cmsg),
                std::mem::size_of_val(&fds),
            );
            assert_eq!(libc::sendmsg(tx.as_raw_fd(), &msg, 0), 1);
        }

        let mut buf = [0u8; 8];
        let err = recv_fd(rx.as_raw_fd(), &mut buf).expect_err("multi fd cmsg");
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn test_send_rejects_oversized_payload_without_panic() {
        let (tx, _rx) = socketpair().expect("socketpair");
        let payload = vec![b'x'; MAX_MESSAGE_BYTES + 1];

        let fd_err = send_fd(tx.as_raw_fd(), &payload, tx.as_raw_fd()).expect_err("send fd");
        assert_eq!(fd_err.kind(), io::ErrorKind::InvalidInput);

        let datagram_err = send_datagram(tx.as_raw_fd(), &payload).expect_err("send datagram");
        assert_eq!(datagram_err.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn test_claim_inherited_transport_absent_env_returns_none() {
        // The test runner never sets the transport env, so the claim must
        // refuse without touching fd 3.
        assert!(claim_inherited_transport().is_none());
    }
}
