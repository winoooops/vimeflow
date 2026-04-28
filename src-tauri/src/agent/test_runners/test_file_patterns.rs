//! Test-file path matching. Frontend reads is_test_file: bool from
//! AgentToolCallEvent and renders accordingly — no JS-side glob.

/// Returns true if `path` matches a known test-file convention.
/// Matches on the basename and (for some languages) directory position.
pub fn is_test_file(path: &str) -> bool {
    let basename = path.rsplit('/').next().unwrap_or(path);

    // TS/JS: *.test.{ts,tsx,js,jsx,mjs,cjs} and *.spec.{...}
    if let Some(stem_end) = basename.rfind('.') {
        let ext = &basename[stem_end + 1..];
        let stem = &basename[..stem_end];
        if matches!(ext, "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs") {
            if let Some(inner_end) = stem.rfind('.') {
                let infix = &stem[inner_end + 1..];
                if infix == "test" || infix == "spec" {
                    return true;
                }
            }
        }
        // Rust: *_test.rs (cargo convention)
        if ext == "rs" && stem.ends_with("_test") {
            return true;
        }
        // Python: test_*.py and *_test.py (pytest convention)
        if ext == "py" && (stem.starts_with("test_") || stem.ends_with("_test")) {
            return true;
        }
        // Go: *_test.go
        if ext == "go" && stem.ends_with("_test") {
            return true;
        }
    }

    // Rust: anything inside a tests/ directory
    if path.contains("/tests/") || path.starts_with("tests/") {
        return true;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ts_test_files_match() {
        assert!(is_test_file("src/foo.test.ts"));
        assert!(is_test_file("src/foo.test.tsx"));
        assert!(is_test_file("src/foo.spec.ts"));
        assert!(is_test_file("/abs/src/bar.test.mjs"));
        assert!(is_test_file("packages/x/src/baz.test.cjs"));
    }

    #[test]
    fn ts_non_test_files_dont_match() {
        assert!(!is_test_file("src/foo.ts"));
        assert!(!is_test_file("src/tests-helper.ts"));
        assert!(!is_test_file("test.txt"));
        assert!(!is_test_file("src/test.config.ts")); // .test. but ext is .ts not .test.ts
    }

    #[test]
    fn rust_test_files_match() {
        assert!(is_test_file("src/foo_test.rs"));
        assert!(is_test_file("crates/x/tests/integration.rs"));
        assert!(is_test_file("tests/it.rs"));
    }

    #[test]
    fn rust_non_test_files_dont_match() {
        assert!(!is_test_file("src/foo.rs"));
        assert!(!is_test_file("src/test_helper.rs")); // not _test.rs and not in tests/
    }

    #[test]
    fn python_test_files_match() {
        assert!(is_test_file("tests/test_foo.py"));
        assert!(is_test_file("src/foo_test.py"));
    }

    #[test]
    fn go_test_files_match() {
        assert!(is_test_file("pkg/foo_test.go"));
    }

    #[test]
    fn empty_and_weird_paths_dont_match() {
        assert!(!is_test_file(""));
        assert!(!is_test_file("/"));
        assert!(!is_test_file("foo"));
    }
}
