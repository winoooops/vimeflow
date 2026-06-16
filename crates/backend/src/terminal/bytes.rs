const BASE64_TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

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
    use super::encode_base64;

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
}
