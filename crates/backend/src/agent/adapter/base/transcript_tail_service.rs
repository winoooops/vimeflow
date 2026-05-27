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

// --- Test support (module-level, `pub(crate)` so the per-provider decoder
// tests in Tasks 2.3/2.4 can drive the same scripted reader). ---

/// One scripted `read_line` outcome.
#[cfg(test)]
pub(crate) enum Step {
    /// `read_line` returns this text verbatim (may or may not end in `\n`).
    Chunk(&'static str),
    /// Non-terminal EOF — `Ok(0)`; the loop fires `on_caught_up` and polls again.
    Eof,
    /// Like `Eof`, but also flips `stop` so the loop exits after this read.
    EofStop,
    /// One read failure — the loop warns, sleeps, and continues.
    Err,
}

#[cfg(test)]
pub(crate) struct ScriptedBufRead {
    pub steps: std::vec::IntoIter<Step>,
    pub stop: Arc<AtomicBool>,
}

#[cfg(test)]
impl std::io::Read for ScriptedBufRead {
    fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
        unreachable!("run only calls read_line")
    }
}

#[cfg(test)]
impl std::io::BufRead for ScriptedBufRead {
    fn fill_buf(&mut self) -> std::io::Result<&[u8]> {
        unreachable!()
    }
    fn consume(&mut self, _: usize) {}
    fn read_line(&mut self, buf: &mut String) -> std::io::Result<usize> {
        match self.steps.next() {
            Some(Step::Chunk(s)) => {
                buf.push_str(s);
                Ok(s.len())
            }
            Some(Step::Err) => Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                "scripted read error",
            )),
            Some(Step::Eof) => Ok(0),
            Some(Step::EofStop) | None => {
                self.stop.store(true, Ordering::Release);
                Ok(0)
            }
        }
    }
}

/// `run` MOVES the decoder, so tests clone the inner `Arc`s up front to inspect
/// what was decoded after the loop returns.
#[cfg(test)]
#[derive(Clone, Default)]
struct RecordingDecoder {
    lines: Arc<std::sync::Mutex<Vec<String>>>,
    caught_up: Arc<std::sync::atomic::AtomicUsize>,
}

#[cfg(test)]
impl TranscriptDecoder for RecordingDecoder {
    fn decode_line(&mut self, line: &str) {
        self.lines.lock().unwrap().push(line.to_string());
    }
    fn on_caught_up(&mut self) {
        self.caught_up.fetch_add(1, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Drive the service over a scripted read sequence and return what the
    /// recording decoder saw: the decoded lines + the `on_caught_up` count.
    fn drive(steps: Vec<Step>) -> (Vec<String>, usize) {
        let stop = Arc::new(AtomicBool::new(false));
        let dec = RecordingDecoder::default();
        let lines = dec.lines.clone();
        let caught = dec.caught_up.clone();
        TranscriptTailService::new(Box::new(dec), "t")
            .with_poll_interval(Duration::ZERO)
            .run(
                ScriptedBufRead {
                    steps: steps.into_iter(),
                    stop: stop.clone(),
                },
                stop,
            );
        let decoded = lines.lock().unwrap().clone();
        (decoded, caught.load(Ordering::Acquire))
    }

    #[test]
    fn engine_partial_survives_eof_then_completes() {
        // A partial buffered before a non-terminal EOF survives and joins the
        // rest of the line when the file grows.
        let (lines, _) = drive(vec![
            Step::Chunk("{\"a\":1"),
            Step::Eof,
            Step::Chunk("23}\n"),
            Step::EofStop,
        ]);
        assert_eq!(lines, ["{\"a\":123}"]);
    }

    #[test]
    fn engine_truncated_partial_never_emits() {
        // A partial that never completes before stop is dropped — and the EOF
        // arm still fired exactly once.
        let (lines, caught) = drive(vec![Step::Chunk("{\"a\":1"), Step::EofStop]);
        assert!(lines.is_empty());
        assert_eq!(caught, 1);
    }

    #[test]
    fn engine_strips_crlf() {
        let (lines, _) = drive(vec![Step::Chunk("{\"a\":1}\r\n"), Step::EofStop]);
        assert_eq!(lines, ["{\"a\":1}"]);
    }

    #[test]
    fn engine_skips_blank_line() {
        let (lines, _) = drive(vec![Step::Chunk("   \n"), Step::EofStop]);
        assert!(lines.is_empty());
    }

    #[test]
    fn engine_read_error_warns_and_continues() {
        // A single read error warns + sleeps + continues; the next line still
        // decodes (pins the frozen error→warn→sleep contract).
        let (lines, _) = drive(vec![
            Step::Chunk("{\"a\":1}\n"),
            Step::Err,
            Step::Chunk("{\"b\":2}\n"),
            Step::EofStop,
        ]);
        assert_eq!(lines, ["{\"a\":1}", "{\"b\":2}"]);
    }
}
