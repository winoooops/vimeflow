const BASE64_TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const PTY_BYTES_BASE64_ENV: &str = "VIMEFLOW_EXPERIMENTAL_PTY_BYTES_BASE64";
const TERMINAL_RENDERER_ENV: &str = "VITE_TERMINAL_RENDERER";
const GHOSTTY_RENDERER_ID: &str = "ghostty";

fn is_truthy_flag(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

pub(crate) fn should_emit_bytes_base64() -> bool {
    should_emit_bytes_base64_for_env(
        std::env::var(PTY_BYTES_BASE64_ENV).ok().as_deref(),
        std::env::var(TERMINAL_RENDERER_ENV).ok().as_deref(),
    )
}

fn is_ghostty_renderer(value: &str) -> bool {
    value.trim() == GHOSTTY_RENDERER_ID
}

fn should_emit_bytes_base64_for_env(
    explicit_flag: Option<&str>,
    terminal_renderer: Option<&str>,
) -> bool {
    explicit_flag.map(is_truthy_flag).unwrap_or(false)
        || terminal_renderer.map(is_ghostty_renderer).unwrap_or(false)
}

pub(crate) fn encode_base64(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(((bytes.len() + 2) / 3) * 4);

    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);

        output.push(BASE64_TABLE[(b0 >> 2) as usize] as char);
        output.push(BASE64_TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);

        if chunk.len() > 1 {
            output.push(BASE64_TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            output.push('=');
        }

        if chunk.len() > 2 {
            output.push(BASE64_TABLE[(b2 & 0b0011_1111) as usize] as char);
        } else {
            output.push('=');
        }
    }

    output
}

#[cfg(test)]
mod tests {
    use super::{encode_base64, should_emit_bytes_base64_for_env};

    #[test]
    fn encodes_empty_input() {
        assert_eq!(encode_base64(b""), "");
    }

    #[test]
    fn encodes_padded_inputs() {
        assert_eq!(encode_base64(b"f"), "Zg==");
        assert_eq!(encode_base64(b"fo"), "Zm8=");
    }

    #[test]
    fn encodes_unpadded_inputs() {
        assert_eq!(encode_base64(b"foo"), "Zm9v");
        assert_eq!(encode_base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn preserves_non_utf8_bytes() {
        assert_eq!(encode_base64(&[0xff, 0xfe, 0x00, 0x61]), "//4AYQ==");
    }

    #[test]
    fn accepts_truthy_feature_flag_values() {
        assert!(super::is_truthy_flag("1"));
        assert!(super::is_truthy_flag("true"));
        assert!(super::is_truthy_flag("YES"));
        assert!(super::is_truthy_flag("on"));
    }

    #[test]
    fn rejects_non_truthy_feature_flag_values() {
        assert!(!super::is_truthy_flag(""));
        assert!(!super::is_truthy_flag("0"));
        assert!(!super::is_truthy_flag("false"));
        assert!(!super::is_truthy_flag("disabled"));
    }

    #[test]
    fn enables_byte_payloads_when_explicit_flag_is_truthy() {
        assert!(should_emit_bytes_base64_for_env(Some("1"), None));
        assert!(should_emit_bytes_base64_for_env(
            Some("true"),
            Some("xterm")
        ));
    }

    #[test]
    fn enables_byte_payloads_for_ghostty_renderer_selection() {
        assert!(should_emit_bytes_base64_for_env(None, Some("ghostty")));
        assert!(should_emit_bytes_base64_for_env(Some("0"), Some("ghostty")));
        assert!(should_emit_bytes_base64_for_env(None, Some(" ghostty ")));
    }

    #[test]
    fn keeps_byte_payloads_disabled_for_default_text_renderers() {
        assert!(!should_emit_bytes_base64_for_env(None, None));
        assert!(!should_emit_bytes_base64_for_env(Some("0"), None));
        assert!(!should_emit_bytes_base64_for_env(None, Some("xterm")));
        assert!(!should_emit_bytes_base64_for_env(
            Some("false"),
            Some("plain-text")
        ));
    }
}
