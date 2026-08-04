use super::types::PtyProgressState;

const MAX_PROGRESS_PAYLOAD_LEN: usize = 256;
const PROGRESS_PREFIX: &[u8] = b"9;4;";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OscProgress {
    pub(crate) state: PtyProgressState,
    pub(crate) value: Option<u8>,
}

#[derive(Debug)]
enum OscKind {
    Prefix(usize),
    Progress(Vec<u8>),
    Ignore,
    Discard,
}

#[derive(Debug)]
struct OscState {
    kind: OscKind,
    escape: bool,
}

#[derive(Debug, Default)]
enum ParserState {
    #[default]
    Ground,
    Escape,
    Osc(OscState),
}

#[derive(Debug, Default)]
pub(crate) struct OscProgressParser {
    state: ParserState,
}

impl OscProgressParser {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn push(&mut self, bytes: &[u8]) -> Vec<OscProgress> {
        bytes
            .iter()
            .filter_map(|byte| self.push_byte(*byte))
            .collect()
    }

    fn push_byte(&mut self, byte: u8) -> Option<OscProgress> {
        match std::mem::take(&mut self.state) {
            ParserState::Ground => {
                self.state = if byte == b'\x1b' {
                    ParserState::Escape
                } else {
                    ParserState::Ground
                };
                None
            }
            ParserState::Escape => {
                self.state = match byte {
                    b']' => ParserState::Osc(OscState {
                        kind: OscKind::Prefix(0),
                        escape: false,
                    }),
                    b'\x1b' => ParserState::Escape,
                    _ => ParserState::Ground,
                };
                None
            }
            ParserState::Osc(osc) => self.push_osc_byte(osc, byte),
        }
    }

    fn push_osc_byte(&mut self, mut osc: OscState, byte: u8) -> Option<OscProgress> {
        if osc.escape {
            if byte == b'\\' {
                return self.finish_osc(osc.kind);
            }

            self.state = ParserState::Escape;
            return self.push_byte(byte);
        }

        match byte {
            b'\x07' => self.finish_osc(osc.kind),
            b'\x1b' => {
                osc.escape = true;
                self.state = ParserState::Osc(osc);
                None
            }
            _ => {
                osc.kind = match osc.kind {
                    OscKind::Prefix(index) if byte == PROGRESS_PREFIX[index] => {
                        if index + 1 == PROGRESS_PREFIX.len() {
                            OscKind::Progress(Vec::new())
                        } else {
                            OscKind::Prefix(index + 1)
                        }
                    }
                    OscKind::Prefix(_) => OscKind::Ignore,
                    OscKind::Progress(mut payload) if payload.len() < MAX_PROGRESS_PAYLOAD_LEN => {
                        payload.push(byte);
                        OscKind::Progress(payload)
                    }
                    OscKind::Progress(_) => OscKind::Discard,
                    kind => kind,
                };
                self.state = ParserState::Osc(osc);
                None
            }
        }
    }

    fn finish_osc(&mut self, kind: OscKind) -> Option<OscProgress> {
        self.state = ParserState::Ground;
        match kind {
            OscKind::Progress(payload) => parse_progress(&payload),
            _ => None,
        }
    }

    #[cfg(test)]
    fn candidate_len(&self) -> usize {
        match &self.state {
            ParserState::Osc(OscState {
                kind: OscKind::Progress(payload),
                ..
            }) => payload.len(),
            _ => 0,
        }
    }
}

fn parse_progress(payload: &[u8]) -> Option<OscProgress> {
    let payload = payload.strip_suffix(b";").unwrap_or(payload);
    let mut fields = payload.split(|byte| *byte == b';');
    let state = fields.next()?;
    let value = fields.next();
    if fields.next().is_some() {
        return None;
    }

    let (state, value) = match (state, value) {
        (b"0", None) => (PtyProgressState::Remove, None),
        (b"1", None) => (PtyProgressState::Normal, Some(0)),
        (b"1", Some(value)) => (PtyProgressState::Normal, Some(parse_percentage(value)?)),
        (b"2", None) => (PtyProgressState::Error, None),
        (b"2", Some(value)) => (PtyProgressState::Error, Some(parse_percentage(value)?)),
        (b"3", None) => (PtyProgressState::Indeterminate, None),
        (b"4", None) => (PtyProgressState::Paused, None),
        (b"4", Some(value)) => (PtyProgressState::Paused, Some(parse_percentage(value)?)),
        _ => return None,
    };

    Some(OscProgress { state, value })
}

fn parse_percentage(value: &[u8]) -> Option<u8> {
    if value.is_empty() || !value.iter().all(u8::is_ascii_digit) {
        return None;
    }

    Some(value.iter().fold(0, |percentage, byte| {
        percentage
            .saturating_mul(10)
            .saturating_add(byte - b'0')
            .min(100)
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn progress(state: PtyProgressState, value: Option<u8>) -> OscProgress {
        OscProgress { state, value }
    }

    fn parse(bytes: &[u8]) -> Vec<OscProgress> {
        OscProgressParser::new().push(bytes)
    }

    #[test]
    fn test_parser_accepts_pilot_captures_and_all_states() {
        assert_eq!(
            parse(b"\x1b]9;4;0;\x07\x1b]9;4;3;\x07\x1b]9;4;3\x07\x1b]9;4;0;\x07"),
            vec![
                progress(PtyProgressState::Remove, None),
                progress(PtyProgressState::Indeterminate, None),
                progress(PtyProgressState::Indeterminate, None),
                progress(PtyProgressState::Remove, None),
            ]
        );
        assert_eq!(
            parse(b"\x1b]9;4;1\x07\x1b]9;4;1;42\x07\x1b]9;4;1;150\x07"),
            vec![
                progress(PtyProgressState::Normal, Some(0)),
                progress(PtyProgressState::Normal, Some(42)),
                progress(PtyProgressState::Normal, Some(100)),
            ]
        );
        assert_eq!(
            parse(b"\x1b]9;4;2\x07\x1b]9;4;2;85\x07\x1b]9;4;4\x07\x1b]9;4;4;70\x07"),
            vec![
                progress(PtyProgressState::Error, None),
                progress(PtyProgressState::Error, Some(85)),
                progress(PtyProgressState::Paused, None),
                progress(PtyProgressState::Paused, Some(70)),
            ]
        );
    }

    #[test]
    fn test_parser_accepts_bel_and_st_terminators() {
        assert_eq!(
            parse(b"\x1b]9;4;1;42\x07\x1b]9;4;4;85\x1b\\"),
            vec![
                progress(PtyProgressState::Normal, Some(42)),
                progress(PtyProgressState::Paused, Some(85)),
            ]
        );
    }

    #[test]
    fn test_parser_handles_every_two_chunk_split_and_one_byte_input() {
        let frame = b"\x1b]9;4;1;42\x1b\\";
        let expected = vec![progress(PtyProgressState::Normal, Some(42))];

        for split in 0..=frame.len() {
            let mut parser = OscProgressParser::new();
            let mut reports = parser.push(&frame[..split]);
            reports.extend(parser.push(&frame[split..]));
            assert_eq!(reports, expected, "split at {split}");
        }

        let mut parser = OscProgressParser::new();
        let reports: Vec<_> = frame
            .iter()
            .flat_map(|byte| parser.push(std::slice::from_ref(byte)))
            .collect();
        assert_eq!(reports, expected);
    }

    #[test]
    fn test_parser_retains_trailing_escape_for_next_chunks_osc_introducer() {
        let mut parser = OscProgressParser::new();
        assert!(parser.push(b"ordinary text\x1b").is_empty());
        assert_eq!(
            parser.push(b"]9;4;3\x07"),
            vec![progress(PtyProgressState::Indeterminate, None)]
        );
    }

    #[test]
    fn test_parser_preserves_report_order_around_text_and_back_to_back_frames() {
        assert_eq!(
            parse(b"before\x1b]9;4;1;20\x07\x1b]9;4;2;80\x07after"),
            vec![
                progress(PtyProgressState::Normal, Some(20)),
                progress(PtyProgressState::Error, Some(80)),
            ]
        );
    }

    #[test]
    fn test_parser_ignores_other_osc_frames_through_their_terminators() {
        assert!(parse(b"\x1b]0;contains 9;4;1;42\x07").is_empty());
        assert!(parse(b"\x1b]777;9;4;3\x1b\\").is_empty());

        let mut parser = OscProgressParser::new();
        assert!(parser.push(b"\x1b]0;not progress\x1b").is_empty());
        assert!(parser.push(b"\\").is_empty());
    }

    #[test]
    fn test_parser_rejects_malformed_or_unterminated_progress() {
        for frame in [
            b"\x1b]9;4\x07".as_slice(),
            b"\x1b]9;4;5\x07",
            b"\x1b]9;4;1;nope\x07",
            b"\x1b]9;4;2;20;extra\x07",
            b"\x1b]9;4;1;42",
        ] {
            assert!(parse(frame).is_empty(), "accepted {frame:?}");
        }
    }

    #[test]
    fn test_parser_recovers_from_unterminated_progress_before_later_escape_sequences() {
        let mut parser = OscProgressParser::new();

        assert!(parser.push(b"\x1b]9;4;1;42\x1b[31mred\x1b[0m").is_empty());
        assert_eq!(
            parser.push(b"\x1b]9;4;4;70\x07"),
            vec![progress(PtyProgressState::Paused, Some(70))]
        );

        assert_eq!(
            parse(b"\x1b]9;4;1;42\x1b]9;4;3\x07"),
            vec![progress(PtyProgressState::Indeterminate, None)]
        );
    }

    #[test]
    fn test_parser_bounds_oversized_candidates_and_recovers_after_terminator() {
        let mut parser = OscProgressParser::new();
        let oversized = format!("\x1b]9;4;1;{}", "7".repeat(MAX_PROGRESS_PAYLOAD_LEN + 1));

        assert!(parser.push(oversized.as_bytes()).is_empty());
        assert!(parser.candidate_len() <= MAX_PROGRESS_PAYLOAD_LEN);
        assert_eq!(
            parser.push(b"\x07\x1b]9;4;3\x07"),
            vec![progress(PtyProgressState::Indeterminate, None)]
        );
    }
}
