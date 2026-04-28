//! Conservative redaction for content shown in the UI. Catches the common
//! shapes; not a comprehensive secret scanner. Applied to BOTH command_preview
//! and output_excerpt.

use once_cell::sync::Lazy;
use regex::Regex;

const REDACTED: &str = "[REDACTED]";

static PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        // KEY=value where KEY is uppercase identifier (env-style)
        Regex::new(r"\b[A-Z][A-Z0-9_]{2,}=\S+").unwrap(),
        // Bearer tokens (case-insensitive)
        Regex::new(r"(?i)\bBearer\s+[A-Za-z0-9._\-]+").unwrap(),
        // Authorization headers (case-insensitive)
        Regex::new(r"(?i)\bAuthorization:\s*\S+").unwrap(),
        // Stripe/etc-style API keys: (sk|pk|rk)_(live|test)_<alnum16+>
        Regex::new(r"\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{16,}").unwrap(),
        // JWT-like: eyJ followed by base64-ish chunk
        Regex::new(r"\beyJ[A-Za-z0-9._\-]{10,}").unwrap(),
    ]
});

pub fn sanitize_for_ui(input: &str) -> String {
    let mut out = input.to_string();
    for re in PATTERNS.iter() {
        out = re.replace_all(&out, REDACTED).to_string();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_env_assignments() {
        let s = sanitize_for_ui("STRIPE_KEY=sk_live_abc123 vitest");
        assert!(!s.contains("sk_live_abc123"));
        assert!(s.contains("[REDACTED]"));
    }

    #[test]
    fn redacts_bearer_tokens() {
        let s = sanitize_for_ui("curl -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.foo'");
        assert!(!s.contains("eyJhbGciOiJIUzI1NiJ9.foo"));
    }

    #[test]
    fn redacts_api_key_prefixes() {
        let s = sanitize_for_ui("--key sk_live_1234567890abcdef1234");
        assert!(!s.contains("sk_live_1234567890abcdef1234"));
    }

    #[test]
    fn redacts_jwt_like() {
        let s = sanitize_for_ui("token: eyJabcdefghijklmnop.body.sig");
        assert!(!s.contains("eyJabcdefghijklmnop"));
    }

    #[test]
    fn clean_strings_unchanged() {
        let s = sanitize_for_ui("vitest run src/foo.test.ts");
        assert_eq!(s, "vitest run src/foo.test.ts");
    }

    #[test]
    fn does_not_redact_short_uppercase_words() {
        // "OK" / "FAIL" without "=" must be untouched
        let s = sanitize_for_ui("FAIL src/foo.test.ts");
        assert_eq!(s, "FAIL src/foo.test.ts");
    }
}
