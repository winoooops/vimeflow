//! Incremental UTF-8 decoding for PTY output chunks.
//!
//! PTY reads slice the byte stream at arbitrary boundaries, so a multi-byte
//! UTF-8 sequence can straddle two `read()` calls. Decoding each chunk
//! independently with `String::from_utf8_lossy` corrupts every straddling
//! character into U+FFFD replacement pairs (VIM ghost-glyph RCA side-fix).
//! `Utf8ChunkDecoder` instead carries the incomplete trailing sequence
//! (at most 3 bytes — a 4-byte scalar missing its last byte) into the next
//! chunk, emitting only fully-decoded text per call.

/// Streaming UTF-8 decoder with a <=3-byte carry across chunks.
///
/// Invalid sequences (bytes that can never begin/continue a valid scalar)
/// are replaced with U+FFFD exactly like `from_utf8_lossy`; only a
/// *possibly-valid* incomplete tail is deferred.
pub(crate) struct Utf8ChunkDecoder {
    /// Bytes of an incomplete trailing sequence held over from the
    /// previous chunk. Max 3: `error_len() == None` guarantees the tail is
    /// a proper prefix of one multi-byte scalar.
    carry: [u8; 3],
    carry_len: usize,
}

impl Utf8ChunkDecoder {
    pub(crate) fn new() -> Self {
        Self {
            carry: [0; 3],
            carry_len: 0,
        }
    }

    /// Number of raw bytes currently carried (0..=3). These bytes are in
    /// the session ring buffer but have NOT been published as decoded
    /// pty-data yet.
    pub(crate) fn carry_len(&self) -> usize {
        self.carry_len
    }

    /// Decode `chunk`, prepending any carried bytes. Invalid sequences
    /// become U+FFFD; an incomplete trailing sequence is carried into the
    /// next call instead of being lossily replaced.
    pub(crate) fn decode(&mut self, chunk: &[u8]) -> String {
        // Prepend the carry so a sequence split across reads reassembles.
        // The copy is tiny (carry <= 3 bytes) and only the error path of
        // `from_utf8` ever loops, so this stays O(chunk.len()).
        let mut bytes = Vec::with_capacity(self.carry_len + chunk.len());
        bytes.extend_from_slice(&self.carry[..self.carry_len]);
        bytes.extend_from_slice(chunk);
        self.carry_len = 0;

        let mut out = String::with_capacity(bytes.len());
        let mut rest: &[u8] = &bytes;
        loop {
            match std::str::from_utf8(rest) {
                Ok(valid) => {
                    out.push_str(valid);
                    break;
                }
                Err(err) => {
                    let (valid, after_valid) = rest.split_at(err.valid_up_to());
                    out.push_str(
                        std::str::from_utf8(valid).expect("prefix validated by valid_up_to"),
                    );
                    match err.error_len() {
                        // Unrecoverably invalid bytes — replace like
                        // `from_utf8_lossy` and keep scanning.
                        Some(invalid_len) => {
                            out.push(char::REPLACEMENT_CHARACTER);
                            rest = &after_valid[invalid_len..];
                        }
                        // Incomplete trailing sequence: a proper prefix of
                        // one multi-byte scalar (max 3 bytes). Carry it.
                        None => {
                            self.carry[..after_valid.len()].copy_from_slice(after_valid);
                            self.carry_len = after_valid.len();
                            break;
                        }
                    }
                }
            }
        }
        out
    }

    /// Flush a dangling carry as a single U+FFFD (WHATWG streaming-decode
    /// termination). Returns `(text, raw_byte_len)` so the caller can keep
    /// the offset stream contiguous, or `None` when nothing is carried.
    pub(crate) fn flush(&mut self) -> Option<(String, usize)> {
        if self.carry_len == 0 {
            return None;
        }
        let len = self.carry_len;
        self.carry_len = 0;
        Some((char::REPLACEMENT_CHARACTER.to_string(), len))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_passes_plain_ascii_through() {
        let mut decoder = Utf8ChunkDecoder::new();
        assert_eq!(decoder.decode(b"hello"), "hello");
        assert_eq!(decoder.carry_len(), 0);
    }

    #[test]
    fn decode_carries_two_byte_sequence_split_across_chunks() {
        // "é" = C3 A9 split between reads.
        let mut decoder = Utf8ChunkDecoder::new();
        assert_eq!(decoder.decode(b"caf\xC3"), "caf");
        assert_eq!(decoder.carry_len(), 1);
        assert_eq!(decoder.decode(b"\xA9"), "\u{e9}");
        assert_eq!(decoder.carry_len(), 0);
    }

    #[test]
    fn decode_carries_three_byte_sequence_byte_at_a_time() {
        // "€" = E2 82 AC fed one byte per read.
        let mut decoder = Utf8ChunkDecoder::new();
        assert_eq!(decoder.decode(b"\xE2"), "");
        assert_eq!(decoder.carry_len(), 1);
        assert_eq!(decoder.decode(b"\x82"), "");
        assert_eq!(decoder.carry_len(), 2);
        assert_eq!(decoder.decode(b"\xAC"), "\u{20ac}");
        assert_eq!(decoder.carry_len(), 0);
    }

    #[test]
    fn decode_carries_four_byte_sequence_split_mid_scalar() {
        // "😀" = F0 9F 98 80 split 2+2.
        let mut decoder = Utf8ChunkDecoder::new();
        assert_eq!(decoder.decode(b"\xF0\x9F"), "");
        assert_eq!(decoder.carry_len(), 2);
        assert_eq!(decoder.decode(b"\x98\x80"), "\u{1f600}");
        assert_eq!(decoder.carry_len(), 0);
    }

    #[test]
    fn decode_reassembles_every_interior_split_of_representative_scalars() {
        // Table of representative scalars, one per UTF-8 length. For each we
        // feed its encoding split at EVERY interior byte boundary (1..len)
        // across two chunks and require an exact, U+FFFD-free reconstruction
        // with the carry accounting for exactly the deferred bytes. The
        // 4-byte scalar's 3+1 split exercises the maximum three-byte carry
        // that the exact-offset tests above never reach.
        let scalars = [
            'a',         // 1 byte
            '\u{e9}',    // 2 bytes: é
            '\u{20ac}',  // 3 bytes: €
            '\u{1f600}', // 4 bytes: 😀
        ];
        let mut saw_max_three_byte_carry = false;

        for scalar in scalars {
            let expected = scalar.to_string();
            let enc = expected.as_bytes();

            // Baseline: the whole scalar in one chunk decodes cleanly. This
            // is the only coverage the 1-byte scalar gets — it has no
            // interior boundary, so the split loop below is empty for it.
            let mut whole = Utf8ChunkDecoder::new();
            assert_eq!(whole.decode(enc), expected, "{scalar:?} whole-chunk decode");
            assert_eq!(whole.carry_len(), 0);

            for split in 1..enc.len() {
                let mut decoder = Utf8ChunkDecoder::new();

                // A proper prefix of one scalar must be fully carried, never
                // lossily emitted.
                let head = decoder.decode(&enc[..split]);
                assert_eq!(
                    head, "",
                    "{scalar:?} split at {split}: a mid-scalar prefix must emit nothing"
                );
                assert_eq!(
                    decoder.carry_len(),
                    split,
                    "{scalar:?} split at {split}: exactly {split} bytes must be carried"
                );
                if decoder.carry_len() == 3 {
                    saw_max_three_byte_carry = true;
                }

                // The continuation completes the scalar and drains the carry.
                let tail = decoder.decode(&enc[split..]);
                assert_eq!(
                    decoder.carry_len(),
                    0,
                    "{scalar:?} split at {split}: completing the scalar must drain the carry"
                );

                let reconstructed = format!("{head}{tail}");
                assert_eq!(
                    reconstructed, expected,
                    "{scalar:?} split at {split} must round-trip exactly"
                );
                assert!(
                    !reconstructed.contains('\u{FFFD}'),
                    "{scalar:?} split at {split} must not introduce U+FFFD"
                );
                assert_eq!(
                    reconstructed.len(),
                    enc.len(),
                    "{scalar:?} split at {split}: decoded byte count must equal the encoding \
                     (no replacement-char expansion)"
                );
            }
        }

        assert!(
            saw_max_three_byte_carry,
            "the 4-byte scalar's 3+1 split must exercise the maximum three-byte carry"
        );
    }

    #[test]
    fn decode_replaces_truly_invalid_byte_with_replacement_char() {
        // 0xFF can never start a UTF-8 sequence — must NOT be carried.
        let mut decoder = Utf8ChunkDecoder::new();
        assert_eq!(decoder.decode(b"ab\xFFcd"), "ab\u{FFFD}cd");
        assert_eq!(decoder.carry_len(), 0);
    }

    #[test]
    fn decode_replaces_carried_prefix_invalidated_by_next_chunk() {
        // C3 expects a continuation byte; 'x' invalidates it. The broken
        // lead byte becomes U+FFFD and 'x' survives.
        let mut decoder = Utf8ChunkDecoder::new();
        assert_eq!(decoder.decode(b"\xC3"), "");
        assert_eq!(decoder.decode(b"x"), "\u{FFFD}x");
        assert_eq!(decoder.carry_len(), 0);
    }

    #[test]
    fn flush_emits_replacement_for_dangling_carry() {
        let mut decoder = Utf8ChunkDecoder::new();
        assert_eq!(decoder.decode(b"caf\xC3"), "caf");
        assert_eq!(
            decoder.flush(),
            Some(("\u{FFFD}".to_string(), 1)),
            "a dangling incomplete tail must flush as one U+FFFD covering its raw bytes"
        );
        assert_eq!(decoder.carry_len(), 0);
        assert_eq!(decoder.flush(), None, "flush is idempotent");
    }

    #[test]
    fn flush_returns_none_without_carry() {
        let mut decoder = Utf8ChunkDecoder::new();
        assert_eq!(decoder.decode(b"plain"), "plain");
        assert_eq!(decoder.flush(), None);
    }
}
