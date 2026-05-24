//! Wrong-type-tolerant serde deserializers shared across adapter DTOs.
//!
//! Step A-status of the v4-frozen refactor plan (#246) migrates Claude
//! and Codex parsers off `serde_json::Value` pull-style extraction and
//! onto typed DTOs. The old pull-style code was unintentionally lenient:
//! a wrong-typed field (e.g. `"42"` where an `u64` was expected) yielded
//! `Value::as_u64() == None` → field-level fallback to `0`, while the
//! rest of the document continued parsing.
//!
//! Strict `#[derive(Deserialize)]` does NOT have that property — a
//! single wrong-typed field fails the whole document. The helpers in
//! this module restore the per-field tolerance by deserializing to
//! `Value` first, then asking the value to coerce. A wrong type
//! produces `Ok(None)`, NOT `Err(_)`. The caller maps `None` to a
//! domain-specific default (usually `0` for token counts /
//! durations).
//!
//! Use via the `deserialize_with` attribute, paired with
//! `#[serde(default)]` so missing / `null` reach the same `None`
//! branch:
//!
//! ```ignore
//! #[derive(Deserialize)]
//! struct Foo {
//!     #[serde(default, deserialize_with = "super::serde_helpers::lenient_u64")]
//!     count: Option<u64>,
//! }
//! ```

use serde::{Deserialize, Deserializer};
use serde_json::Value;

/// Deserialize an `Option<u64>` field with wrong-type tolerance.
///
/// Returns `Ok(None)` when the value is missing, `null`, a non-integer
/// number, a string, an array, or any other JSON type that cannot
/// represent a `u64`. Returns `Ok(Some(_))` when the value is a JSON
/// integer that fits in `u64`.
///
/// Mirrors the pre-A-status behavior of
/// `value.get(key).and_then(Value::as_u64)`.
pub(super) fn lenient_u64<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Value::deserialize(deserializer)?.as_u64())
}

/// Deserialize an `Option<f64>` field with wrong-type tolerance.
///
/// Returns `Ok(None)` for missing / `null` / non-numeric / non-finite
/// inputs. Returns `Ok(Some(_))` for any JSON number (including
/// integers, which `serde_json` coerces to `f64` lossily for large
/// magnitudes — same coercion `Value::as_f64` already applies).
///
/// Mirrors the pre-A-status behavior of
/// `value.get(key).and_then(Value::as_f64)`.
pub(super) fn lenient_f64<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Value::deserialize(deserializer)?.as_f64())
}

/// Deserialize an `Option<String>` field with wrong-type tolerance.
///
/// Returns `Ok(None)` when the value is missing, `null`, a number, an
/// array, or any non-string JSON type. Returns `Ok(Some(_))` for
/// strings.
///
/// Mirrors the pre-A-status behavior of
/// `value.get(key).and_then(Value::as_str).map(str::to_string)`.
pub(super) fn lenient_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Value::deserialize(deserializer)?
        .as_str()
        .map(str::to_string))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize, Debug, PartialEq)]
    struct Probe {
        #[serde(default, deserialize_with = "lenient_u64")]
        count: Option<u64>,
        #[serde(default, deserialize_with = "lenient_f64")]
        ratio: Option<f64>,
        #[serde(default, deserialize_with = "lenient_string")]
        label: Option<String>,
    }

    #[test]
    fn lenient_u64_accepts_integer_rejects_others() {
        // Happy paths
        let p: Probe = serde_json::from_str(r#"{"count": 42}"#).expect("integer ok");
        assert_eq!(p.count, Some(42));

        // Wrong types → None (NOT Err); whole document continues parsing
        let p: Probe = serde_json::from_str(r#"{"count": "42"}"#).expect("string ok→None");
        assert_eq!(p.count, None);

        let p: Probe = serde_json::from_str(r#"{"count": 42.5}"#).expect("float ok→None");
        assert_eq!(p.count, None);

        let p: Probe = serde_json::from_str(r#"{"count": -5}"#).expect("negative ok→None");
        assert_eq!(p.count, None);

        let p: Probe = serde_json::from_str(r#"{"count": null}"#).expect("null ok→None");
        assert_eq!(p.count, None);

        let p: Probe = serde_json::from_str(r#"{}"#).expect("missing ok→None");
        assert_eq!(p.count, None);
    }

    #[test]
    fn lenient_f64_accepts_numbers_rejects_others() {
        let p: Probe = serde_json::from_str(r#"{"ratio": 3.14}"#).expect("float ok");
        assert_eq!(p.ratio, Some(3.14));

        // Integer coerces to f64 — matches `Value::as_f64` behavior
        let p: Probe = serde_json::from_str(r#"{"ratio": 42}"#).expect("integer ok→Some");
        assert_eq!(p.ratio, Some(42.0));

        // Wrong types → None
        let p: Probe = serde_json::from_str(r#"{"ratio": "3.14"}"#).expect("string ok→None");
        assert_eq!(p.ratio, None);

        let p: Probe = serde_json::from_str(r#"{"ratio": null}"#).expect("null ok→None");
        assert_eq!(p.ratio, None);
    }

    #[test]
    fn lenient_string_accepts_strings_rejects_others() {
        let p: Probe = serde_json::from_str(r#"{"label": "hello"}"#).expect("string ok");
        assert_eq!(p.label.as_deref(), Some("hello"));

        let p: Probe = serde_json::from_str(r#"{"label": 42}"#).expect("number ok→None");
        assert_eq!(p.label, None);

        let p: Probe = serde_json::from_str(r#"{"label": null}"#).expect("null ok→None");
        assert_eq!(p.label, None);
    }

    /// Per-field tolerance — one wrong-typed field does NOT poison
    /// the rest of the document. This is the defining property the
    /// helpers exist to preserve.
    #[test]
    fn one_wrong_field_does_not_poison_the_rest() {
        let p: Probe = serde_json::from_str(r#"{"count": "garbage", "ratio": 0.5, "label": "ok"}"#)
            .expect("partial degradation");
        assert_eq!(p.count, None);
        assert_eq!(p.ratio, Some(0.5));
        assert_eq!(p.label.as_deref(), Some("ok"));
    }
}
