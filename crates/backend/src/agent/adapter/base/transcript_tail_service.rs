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
//! fires on **every** EOF where the partial buffer is empty (NOT just the
//! first — implementations MUST be idempotent, see the trait docstring), and
//! a read error warns + sleeps + continues rather than tearing the watcher
//! down. The empty-partial guard is load-bearing: firing the boundary signal
//! while a line is half-buffered would let decoders that flush replay-only
//! emitter state at that signal classify the straddling line — which started
//! during replay — as a live event when it eventually completes.
//!
//! [`on_caught_up`]: TranscriptDecoder::on_caught_up

use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Poll cadence between EOF reads of the growing transcript file. Moved here
/// from the per-provider modules so both tails share one value.
pub(crate) const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// Hard cap on the partial-line buffer to prevent runaway memory growth from a
/// pathological writer that emits data without ever terminating a line.
/// Production Claude / Codex JSONL writers always terminate with `\n`, so this
/// cap is hit only on a writer bug, a truncated mid-write file, or a corrupt
/// transcript. When the cap would be exceeded, the partial is discarded and
/// the engine enters "skip until next newline" mode, then resumes normal
/// processing at the next complete line. 4 MiB is well above any single
/// JSONL line we would ever see in practice (typical lines are <10 KiB; the
/// largest realistic line — a long tool result — is still <1 MiB), so
/// legitimate traffic never trips this. PR #302 cycle 11 F3 introduced the
/// cap; cycle 14 F1 (codex P2) tightened the enforcement to bound allocation
/// DURING the read rather than checking AFTER `read_line` had already
/// allocated the entire giant line.
pub(crate) const MAX_PARTIAL_BYTES: usize = 4 * 1024 * 1024;

/// Per-`Read::read` chunk size. Fixed-size so each iteration's allocation is
/// bounded by this constant, independent of how large the underlying line
/// might be. 8 KiB is small enough that a 4 MiB partial fills in ≤512
/// iterations (well within a single 500ms poll cycle) and large enough that
/// per-syscall overhead is amortized across realistic line sizes
/// (typical Claude / Codex JSONL lines are <10 KiB). PR #302 cycle 14 F1.
pub(crate) const READ_CHUNK_BYTES: usize = 8 * 1024;

/// The provider-specific seam: turns one complete transcript line into events,
/// and reacts to the EOF / caught-up signal. Implementations own their
/// per-session parse state (in-flight tool calls, turn counts, last cwd).
pub(crate) trait TranscriptDecoder: Send {
    /// Decode one complete (newline-stripped, non-blank) transcript line.
    fn decode_line(&mut self, line: &str);
    /// Called on **every** EOF (`Ok(0)` read) where the partial-line
    /// buffer is empty. Implementations MUST be idempotent — this fires
    /// repeatedly during steady-state live tailing (every poll cycle,
    /// ≈ POLL_INTERVAL = 500ms), not just at the initial replay→live
    /// boundary.
    ///
    /// **Idempotency contract.** Treat each call as "the writer has
    /// caught me up to its current end-of-file; flush any pending
    /// emit-batches and return to a steady state." A handler that
    /// emits a non-idempotent side effect (a summary event, a
    /// state-machine transition, etc.) will misbehave every 500ms
    /// during live tailing. If you genuinely need "the replay just
    /// ended" exactly-once, implement that as a per-decoder
    /// `bool replay_done` flag set on the first call and short-circuit
    /// subsequent calls.
    ///
    /// **Partial-buffer guard (PR #302 review F3).** The engine
    /// suppresses this call when a straddling line is half-buffered,
    /// so any line already-buffered before the signal will be decoded
    /// BEFORE the signal fires. If the writer truncated mid-line and
    /// never completes, the signal stays parked — there is no
    /// boundary to cross.
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

    /// Tail `reader` until `stop` is set, dispatching each complete line to
    /// the decoder. Reads in fixed-size chunks (`READ_CHUNK_BYTES`) and
    /// scans for `\n` manually so the partial-line buffer's
    /// `MAX_PARTIAL_BYTES` cap actually limits allocation during the read,
    /// not just after (PR #302 cycle 14 F1 — codex P2 caught that the
    /// pre-cycle-14 `BufRead::read_line` form let a giant unterminated line
    /// fully allocate before the cap-check ran). Buffers a trailing partial
    /// across EOF, strips CRLF, skips blank lines, fires `on_caught_up` on
    /// each EOF where `partial.is_empty()`, treats a read error as warn +
    /// sleep + continue, and silently skips non-UTF-8 lines (with a warn).
    ///
    /// **Over-cap behavior:** when accumulating bytes into `partial` would
    /// exceed `MAX_PARTIAL_BYTES`, the partial is discarded and the engine
    /// enters skip-until-newline mode. Subsequent bytes within the
    /// over-long line are dropped until the next `\n`, at which point
    /// normal processing resumes from the line AFTER the bad one.
    pub(crate) fn run<R: Read>(mut self, mut reader: R, stop: Arc<AtomicBool>) {
        let mut chunk = [0u8; READ_CHUNK_BYTES];
        let mut partial: Vec<u8> = Vec::new();
        // True iff we exceeded MAX_PARTIAL_BYTES on the current line; bytes
        // are discarded until the next `\n` resets us to normal processing.
        let mut skip_until_newline = false;
        while !stop.load(Ordering::Acquire) {
            match reader.read(&mut chunk) {
                Ok(0) => {
                    // Defer the replay→live boundary signal while a partial
                    // line is half-buffered: firing on_caught_up here would
                    // let decoders that flush replay-only emitter state at
                    // that signal classify the eventually-completed
                    // straddling line as a live event, even though it
                    // started during replay (PR #302 Claude review F3).
                    // Same guard applies during skip mode — if we're in
                    // the middle of dropping a runaway line, the writer
                    // hasn't truly "caught up" yet.
                    if partial.is_empty() && !skip_until_newline {
                        self.decoder.on_caught_up();
                    }
                    std::thread::sleep(self.poll_interval);
                }
                Ok(n) => {
                    self.process_chunk(&chunk[..n], &mut partial, &mut skip_until_newline);
                }
                Err(e) => {
                    log::warn!("Error reading {}: {}", self.provider_label, e);
                    std::thread::sleep(self.poll_interval);
                }
            }
        }
    }

    /// Scan `input` for `\n` boundaries, append/process accordingly. Splits
    /// out of `run` so the per-chunk state-machine is testable in isolation
    /// (and so `run`'s outer loop stays a single match expression).
    fn process_chunk(
        &mut self,
        mut input: &[u8],
        partial: &mut Vec<u8>,
        skip_until_newline: &mut bool,
    ) {
        while !input.is_empty() {
            match input.iter().position(|&b| b == b'\n') {
                Some(pos) => {
                    let (head, rest) = input.split_at(pos + 1);
                    if *skip_until_newline {
                        // The `\n` terminates the over-long line — reset
                        // and resume normal processing from `rest`.
                        *skip_until_newline = false;
                    } else if partial.len().saturating_add(head.len()) > MAX_PARTIAL_BYTES {
                        // PR #302 cycle 14 retry-1: cap check on the
                        // newline-arrives-in-crossing-chunk path. Codex
                        // verify caught that the cap was only enforced
                        // in the no-newline branch — a partial near the
                        // cap followed by a chunk like `b"x\n"` would
                        // hit `Some(pos)` and decode the over-limit
                        // line. Now we discard the head (the over-long
                        // line's terminator), clear partial, and resume
                        // normal processing from `rest`. No skip mode
                        // needed: the newline IS in `head`, so the
                        // line is fully consumed here.
                        log::warn!(
                            "{} tail: partial line buffer would exceed {} bytes (newline \
                             in same chunk); discarding (likely writer bug or corrupt file)",
                            self.provider_label,
                            MAX_PARTIAL_BYTES,
                        );
                        partial.clear();
                    } else {
                        partial.extend_from_slice(head);
                        // Try to decode as UTF-8; non-UTF-8 lines are
                        // skipped with a warn rather than crashing the
                        // tail (defensive — real JSONL is always UTF-8,
                        // but a corrupt file shouldn't kill the watcher).
                        match std::str::from_utf8(partial) {
                            Ok(line_str) => {
                                let trimmed = line_str.trim_end_matches(['\r', '\n']);
                                if !trimmed.trim().is_empty() {
                                    self.decoder.decode_line(trimmed);
                                }
                            }
                            Err(_) => {
                                log::warn!(
                                    "{} tail: non-UTF-8 line, skipping",
                                    self.provider_label,
                                );
                            }
                        }
                        partial.clear();
                    }
                    input = rest;
                }
                None => {
                    // No newline in remaining input — either accumulate
                    // into `partial` (if under the cap) or enter skip mode.
                    if *skip_until_newline {
                        // Still no newline; keep dropping.
                    } else if partial.len().saturating_add(input.len()) > MAX_PARTIAL_BYTES {
                        log::warn!(
                            "{} tail: partial line buffer would exceed {} bytes; \
                             entering skip-until-newline mode (likely writer bug \
                             or corrupt file)",
                            self.provider_label,
                            MAX_PARTIAL_BYTES,
                        );
                        partial.clear();
                        *skip_until_newline = true;
                    } else {
                        partial.extend_from_slice(input);
                    }
                    // Consume all of `input` — the leftover is either
                    // safely in `partial`, dropped, or discarded.
                    input = &[];
                }
            }
        }
    }
}

// --- Test support (module-level, `pub(crate)` so the per-provider decoder
// tests in Tasks 2.3/2.4 can drive the same scripted reader). ---

/// One scripted `read` outcome. Drives the chunked-read loop in
/// `TranscriptTailService::run` by emitting one `Read::read` result per
/// step (PR #302 cycle 14 F1 — was `BufRead::read_line`-based before).
#[cfg(test)]
pub(crate) enum Step {
    /// `read` returns these bytes verbatim. To exercise chunking, split
    /// a multi-line input across multiple `Chunk` steps. Newlines must
    /// be present in the chunk content if line termination is desired.
    Chunk(&'static [u8]),
    /// Non-terminal EOF — `Ok(0)`; the loop fires `on_caught_up` (if
    /// partial is empty AND not in skip mode) and polls again.
    Eof,
    /// Like `Eof`, but also flips `stop` so the loop exits after this read.
    EofStop,
    /// One read failure — the loop warns, sleeps, and continues.
    Err,
}

#[cfg(test)]
pub(crate) struct ScriptedReader {
    pub steps: std::vec::IntoIter<Step>,
    pub stop: Arc<AtomicBool>,
    /// Remainder of a `Chunk` step too large to fit in a single
    /// `Read::read` buffer — returned on subsequent calls until exhausted,
    /// then the next step is consumed (PR #302 cycle 14 F1's
    /// over-cap-line regression test passes a `MAX_PARTIAL_BYTES + 1`
    /// chunk that's 4 MiB+, far larger than the engine's 8 KiB read
    /// buffer; the engine then sees a series of bounded reads as if
    /// from a real File).
    #[cfg(test)]
    pub(crate) pending: &'static [u8],
}

#[cfg(test)]
impl ScriptedReader {
    pub(crate) fn new(steps: std::vec::IntoIter<Step>, stop: Arc<AtomicBool>) -> Self {
        Self {
            steps,
            stop,
            pending: &[],
        }
    }
}

#[cfg(test)]
impl std::io::Read for ScriptedReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        // Drain pending bytes from a previous oversized chunk first.
        if !self.pending.is_empty() {
            let n = self.pending.len().min(buf.len());
            buf[..n].copy_from_slice(&self.pending[..n]);
            self.pending = &self.pending[n..];
            return Ok(n);
        }
        match self.steps.next() {
            Some(Step::Chunk(bytes)) => {
                let n = bytes.len().min(buf.len());
                buf[..n].copy_from_slice(&bytes[..n]);
                if n < bytes.len() {
                    self.pending = &bytes[n..];
                }
                Ok(n)
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
                ScriptedReader::new(steps.into_iter(), stop.clone()),
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
            Step::Chunk(b"{\"a\":1"),
            Step::Eof,
            Step::Chunk(b"23}\n"),
            Step::EofStop,
        ]);
        assert_eq!(lines, ["{\"a\":123}"]);
    }

    #[test]
    fn engine_truncated_partial_never_emits() {
        // A partial that never completes before stop is dropped, AND the
        // replay→live boundary signal (on_caught_up) stays parked — every
        // EOF that occurred while the partial was buffered is gated by the
        // empty-partial guard. Decoders keep accumulating replay-only state,
        // which is the correct semantic for "the transcript replay never
        // completed" (PR #302 Claude review F3).
        let (lines, caught) = drive(vec![Step::Chunk(b"{\"a\":1"), Step::EofStop]);
        assert!(lines.is_empty());
        assert_eq!(caught, 0);
    }

    #[test]
    fn engine_caught_up_defers_until_partial_completes() {
        // Regression test for PR #302 Claude review F3 — the engine must NOT
        // fire on_caught_up while a partial line is half-buffered. The
        // ordering pinned here: chunk(open) → Eof (deferred — partial
        // non-empty) → chunk(close) → EofStop (partial cleared after
        // decode_line) → on_caught_up fires exactly once.
        let (lines, caught) = drive(vec![
            Step::Chunk(b"{\"a\":1"),
            Step::Eof,
            Step::Chunk(b"23}\n"),
            Step::EofStop,
        ]);
        assert_eq!(lines, ["{\"a\":123}"]);
        assert_eq!(caught, 1);
    }

    #[test]
    fn engine_caught_up_fires_on_every_empty_eof_documenting_idempotency_requirement() {
        // PR #302 cycle 12 review F1 — pins the engine's actual behavior:
        // `on_caught_up` fires on EVERY EOF where the partial buffer is
        // empty, NOT just the first ("replay→live boundary"). Decoders
        // MUST be idempotent. Without this test, a future maintainer
        // could read the partial-guard logic alone, conclude the signal
        // fires once per replay, and write a non-idempotent
        // `on_caught_up` handler that misfires every poll cycle (~500ms)
        // during steady-state live tailing.
        //
        // Three consecutive empty-partial EOFs → three on_caught_up
        // calls. The recording decoder's `caught_up` counter is itself
        // idempotent (just increments an AtomicUsize), so this test
        // doesn't assert any specific decoder behavior — only the
        // engine's fire-cadence contract.
        let (lines, caught) = drive(vec![
            Step::Chunk(b"{\"a\":1}\n"),
            Step::Eof,
            Step::Eof,
            Step::EofStop,
        ]);
        assert_eq!(lines, ["{\"a\":1}"]);
        assert_eq!(
            caught, 3,
            "on_caught_up must fire on every empty-partial EOF (3 total: 2 Eof + 1 EofStop)",
        );
    }

    #[test]
    fn engine_strips_crlf() {
        let (lines, _) = drive(vec![Step::Chunk(b"{\"a\":1}\r\n"), Step::EofStop]);
        assert_eq!(lines, ["{\"a\":1}"]);
    }

    #[test]
    fn engine_skips_blank_line() {
        let (lines, _) = drive(vec![Step::Chunk(b"   \n"), Step::EofStop]);
        assert!(lines.is_empty());
    }

    #[test]
    fn engine_read_error_warns_and_continues() {
        // A single read error warns + sleeps + continues; the next line still
        // decodes (pins the frozen error→warn→sleep contract).
        let (lines, _) = drive(vec![
            Step::Chunk(b"{\"a\":1}\n"),
            Step::Err,
            Step::Chunk(b"{\"b\":2}\n"),
            Step::EofStop,
        ]);
        assert_eq!(lines, ["{\"a\":1}", "{\"b\":2}"]);
    }

    /// PR #302 cycle 14 retry-1 — over-cap line whose terminating
    /// newline arrives in the SAME crossing chunk must be discarded
    /// just like the skip-mode path. Codex verify caught that the
    /// initial cycle-14 fix only checked the cap in the no-newline
    /// branch — a partial near the cap followed by `b"x\n"` would
    /// reach the newline branch and decode the over-limit line.
    /// This test pins the same-chunk-newline cap-enforcement.
    #[test]
    fn engine_over_cap_line_with_newline_in_crossing_chunk_is_discarded() {
        // Build a chunk that's MAX_PARTIAL_BYTES + 1 bytes ending in
        // `\n`. Without the cap check on the newline path, the engine
        // would decode this as a complete line. With the fix, the
        // entire over-long line is discarded.
        let mut big = vec![b'x'; MAX_PARTIAL_BYTES];
        big.push(b'\n'); // terminator IS in the crossing chunk
        let big: &'static [u8] = Box::leak(big.into_boxed_slice());
        let (lines, _) = drive(vec![
            Step::Chunk(big),
            Step::Chunk(b"{\"a\":1}\n"), // next valid line decodes
            Step::EofStop,
        ]);
        assert_eq!(
            lines,
            ["{\"a\":1}"],
            "over-cap line (newline in same chunk) must be discarded, not decoded",
        );
    }

    /// PR #302 cycle 14 F1 — over-cap line is discarded and the engine
    /// enters skip-until-newline mode; processing resumes on the NEXT
    /// complete line. Uses a leaked chunk of `MAX_PARTIAL_BYTES + 1`
    /// bytes (no `\n` in it) to trip the cap on a single read; a
    /// subsequent valid line is decoded normally.
    ///
    /// Pre-cycle-14 the `read_line`-based engine would have allocated
    /// the entire over-long line into `line_buf` BEFORE checking the
    /// cap — defeating the cap's purpose. The chunked-read engine
    /// processes input as it arrives and discards once the partial
    /// would exceed the cap, so allocation is bounded by
    /// `MAX_PARTIAL_BYTES` regardless of how large the input line is.
    #[test]
    fn engine_over_cap_line_is_discarded_and_processing_resumes() {
        // Build a single chunk that exceeds MAX_PARTIAL_BYTES, with no
        // newline so the engine has to enter skip mode. Leak to get
        // `&'static [u8]` for the Step variant.
        let big: &'static [u8] = Box::leak(vec![b'x'; MAX_PARTIAL_BYTES + 1].into_boxed_slice());
        let (lines, _) = drive(vec![
            Step::Chunk(big),
            Step::Chunk(b"\n"),        // terminate the over-long line; exits skip mode
            Step::Chunk(b"{\"b\":2}\n"), // next valid line decodes normally
            Step::EofStop,
        ]);
        assert_eq!(
            lines,
            ["{\"b\":2}"],
            "over-cap line is discarded; subsequent line decodes normally",
        );
    }
}
