//! Provider-neutral transcript tail engine (step C).
//!
//! Both the Claude Code and Codex transcript watchers previously carried a
//! near-identical `tail_loop`: read lines from a growing JSONL file, buffer a
//! trailing partial across the EOF poll boundary, strip CRLF, skip blank
//! lines, and hand each complete line to a provider-specific parser. This
//! module collapses that duplication into one [`TranscriptTailService`] driven
//! by an injected [`TranscriptDecoder`] — the decoder is the only
//! provider-specific seam.
//!
//! The loop owns the frozen line-buffering contract (F-EVENTS replay→live
//! boundary): a partial line survives a non-terminal EOF, [`on_caught_up`]
//! fires on the first EOF of each catch-up, and a read error warns + sleeps +
//! continues rather than tearing the watcher down.
//!
//! [`on_caught_up`]: TranscriptDecoder::on_caught_up

use std::io::BufRead;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Poll cadence between EOF reads of the growing transcript file. Moved here
/// from the per-provider modules so both tails share one value.
pub(crate) const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// The provider-specific seam: turns one complete transcript line into events,
/// and reacts to the replay→live boundary. Implementations own their
/// per-session parse state (in-flight tool calls, turn counts, last cwd).
pub(crate) trait TranscriptDecoder: Send {
    /// Decode one complete (newline-stripped, non-blank) transcript line.
    fn decode_line(&mut self, line: &str);
    /// Called on the first EOF of each catch-up pass — the replay→live
    /// boundary. Used to flush replay-only emitter state exactly once.
    fn on_caught_up(&mut self);
}

/// Owns the read/buffer/normalize loop; delegates per-line semantics to the
/// injected [`TranscriptDecoder`].
pub(crate) struct TranscriptTailService {
    decoder: Box<dyn TranscriptDecoder>,
    provider_label: &'static str,
    poll_interval: Duration,
}

impl TranscriptTailService {
    pub(crate) fn new(decoder: Box<dyn TranscriptDecoder>, provider_label: &'static str) -> Self {
        Self {
            decoder,
            provider_label,
            poll_interval: POLL_INTERVAL,
        }
    }

    /// Override the poll cadence (tests drive `Duration::ZERO` so the EOF
    /// sleeps are no-ops).
    #[cfg(test)]
    pub(crate) fn with_poll_interval(mut self, d: Duration) -> Self {
        self.poll_interval = d;
        self
    }

    /// Tail `reader` line-by-line until `stop` is set, dispatching each
    /// complete line to the decoder. Buffers a trailing partial across EOF,
    /// strips CRLF, skips blank lines, fires `on_caught_up` on each EOF, and
    /// treats a read error as warn + sleep + continue.
    pub(crate) fn run<R: BufRead>(mut self, mut reader: R, stop: Arc<AtomicBool>) {
        let mut line_buf = String::new();
        let mut partial = String::new();
        while !stop.load(Ordering::Acquire) {
            line_buf.clear();
            match reader.read_line(&mut line_buf) {
                Ok(0) => {
                    self.decoder.on_caught_up();
                    std::thread::sleep(self.poll_interval);
                }
                Ok(_) => {
                    if !line_buf.ends_with('\n') {
                        partial.push_str(&line_buf);
                        continue;
                    }
                    let full = if partial.is_empty() {
                        line_buf.as_str()
                    } else {
                        partial.push_str(&line_buf);
                        partial.as_str()
                    };
                    let trimmed = full.trim_end_matches(['\r', '\n']);
                    if !trimmed.trim().is_empty() {
                        self.decoder.decode_line(trimmed);
                    }
                    partial.clear();
                }
                Err(e) => {
                    log::warn!("Error reading {} line: {}", self.provider_label, e);
                    std::thread::sleep(self.poll_interval);
                }
            }
        }
    }
}
