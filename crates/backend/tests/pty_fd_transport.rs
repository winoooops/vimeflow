//! Phase 1 proof test for the PTY winsize-atomicity transport (VIM-399):
//! a PTY master fd transferred over the SCM_RIGHTS channel lets the receiver
//! apply `TIOCSWINSZ`, the owner observes the new size, and the child process
//! on the PTY observes `SIGWINCH`.
//!
//! Design: docs/superpowers/specs/2026-07-28-pty-winsize-atomicity.md

#![cfg(unix)]

use std::io::Read;
use std::os::fd::AsRawFd;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use vimeflow_lib::fd_transport::{recv_fd, send_fd, socketpair};

const DEADLINE: Duration = Duration::from_secs(10);

fn wait_until(mut condition: impl FnMut() -> bool, what: &str) {
    let start = Instant::now();
    while !condition() {
        assert!(start.elapsed() < DEADLINE, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn test_transferred_pty_fd_applies_winsize_and_child_observes_sigwinch() {
    let pty = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty");

    // The child prints a marker on SIGWINCH so the test can observe delivery.
    let mut cmd = CommandBuilder::new("/bin/sh");
    cmd.args([
        "-c",
        "trap 'printf SIGWINCH-SEEN' WINCH; printf READY; while :; do sleep 0.05; done",
    ]);
    let mut child = pty.slave.spawn_command(cmd).expect("spawn child");

    let mut reader = pty.master.try_clone_reader().expect("reader");
    let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 512];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || out_tx.send(buf[..n].to_vec()).is_err() {
                break;
            }
        }
    });

    let mut output = Vec::new();
    let drain = |output: &mut Vec<u8>| {
        while let Ok(chunk) = out_rx.try_recv() {
            output.extend_from_slice(&chunk);
        }
    };
    wait_until(
        || {
            drain(&mut output);
            output.windows(5).any(|w| w == b"READY")
        },
        "child READY marker",
    );

    let master_fd = pty
        .master
        .as_raw_fd()
        .expect("portable-pty exposes the master fd on unix");

    // Transfer a copy of the master over the SCM_RIGHTS channel, exactly as
    // Rust will hand it to the native addon.
    let (rust_end, addon_end) = socketpair().expect("transport socketpair");
    send_fd(rust_end.as_raw_fd(), b"{\"sessionId\":\"t\"}", master_fd).expect("send fd");

    let mut buf = [0u8; 128];
    let (n, received) = recv_fd(addon_end.as_raw_fd(), &mut buf).expect("recv fd");
    assert_eq!(&buf[..n], b"{\"sessionId\":\"t\"}");
    let received = received.expect("pty fd should arrive");

    // Receiver-side TIOCSWINSZ — the addon's synchronous resize.
    let new_size = libc::winsize {
        ws_row: 31,
        ws_col: 97,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    // SAFETY: received is an open pty master owned by this test.
    let rc = unsafe { libc::ioctl(received.as_raw_fd(), libc::TIOCSWINSZ, &new_size) };
    assert_eq!(rc, 0, "TIOCSWINSZ via the transferred fd must succeed");

    // The original owner reads the size the receiver set.
    let size = pty.master.get_size().expect("get_size");
    assert_eq!((size.rows, size.cols), (31, 97));

    // The kernel delivered SIGWINCH to the child's process group.
    wait_until(
        || {
            drain(&mut output);
            output.windows(13).any(|w| w == b"SIGWINCH-SEEN")
        },
        "child SIGWINCH marker",
    );

    child.kill().ok();
    child.wait().ok();
}
