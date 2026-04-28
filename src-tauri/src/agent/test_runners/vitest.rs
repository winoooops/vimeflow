use std::path::Path;

use super::types::{CapturedOutput, TestRunSummary, TestRunner};

pub static VITEST: TestRunner = TestRunner {
    name: "vitest",
    matches: vitest_matches,
    parse_result: vitest_parse_result,
};

fn vitest_matches(tokens: &[&str]) -> bool {
    matches!(tokens.first(), Some(&"vitest"))
}

fn vitest_parse_result(_out: &CapturedOutput, _cwd: &Path) -> Option<TestRunSummary> {
    // Implemented in Task 5
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vitest_matches_first_token() {
        assert!((VITEST.matches)(&["vitest"]));
        assert!((VITEST.matches)(&["vitest", "run", "src/foo.test.ts"]));
        assert!(!(VITEST.matches)(&["jest"]));
        assert!(!(VITEST.matches)(&[]));
    }
}
