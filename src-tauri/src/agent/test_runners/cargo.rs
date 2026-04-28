use std::path::Path;

use super::types::{CapturedOutput, TestRunSummary, TestRunner};

pub static CARGO_TEST: TestRunner = TestRunner {
    name: "cargo",
    matches: cargo_matches,
    parse_result: cargo_parse_result,
};

fn cargo_matches(tokens: &[&str]) -> bool {
    matches!(tokens, ["cargo", "test", ..])
}

fn cargo_parse_result(_out: &CapturedOutput, _cwd: &Path) -> Option<TestRunSummary> {
    // Implemented in Task 10
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cargo_matches_cargo_test() {
        assert!((CARGO_TEST.matches)(&["cargo", "test"]));
        assert!((CARGO_TEST.matches)(&["cargo", "test", "--release"]));
        assert!(!(CARGO_TEST.matches)(&["cargo", "build"]));
        assert!(!(CARGO_TEST.matches)(&["cargo"]));
        assert!(!(CARGO_TEST.matches)(&[]));
    }
}
