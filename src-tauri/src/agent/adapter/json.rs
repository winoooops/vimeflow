//! Shared JSON-extraction primitives consumed by adapter parsers.

use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

pub fn navigate<'a>(v: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter().try_fold(v, |acc, key| acc.get(*key))
}

pub fn extract<T: DeserializeOwned>(v: &Value, path: &[&str]) -> Option<T> {
    let leaf = navigate(v, path)?;
    serde_json::from_value(leaf.clone()).ok()
}

pub fn u64_at(v: &Value, path: &[&str]) -> Option<u64> {
    navigate(v, path).and_then(Value::as_u64)
}

pub fn f64_at(v: &Value, path: &[&str]) -> Option<f64> {
    navigate(v, path).and_then(Value::as_f64)
}

pub fn str_at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a str> {
    navigate(v, path).and_then(Value::as_str)
}

pub fn bool_at(v: &Value, path: &[&str]) -> Option<bool> {
    navigate(v, path).and_then(Value::as_bool)
}

pub fn obj_at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a Map<String, Value>> {
    navigate(v, path).and_then(Value::as_object)
}

pub fn u64_or(v: &Value, path: &[&str], default: u64) -> u64 {
    u64_at(v, path).unwrap_or(default)
}

pub fn f64_or(v: &Value, path: &[&str], default: f64) -> f64 {
    f64_at(v, path).unwrap_or(default)
}

pub fn str_or<'a>(v: &'a Value, path: &[&str], default: &'a str) -> &'a str {
    str_at(v, path).unwrap_or(default)
}

pub fn bool_or(v: &Value, path: &[&str], default: bool) -> bool {
    bool_at(v, path).unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Value {
        json!({
            "model": { "id": "claude-opus-4", "display_name": "Opus 4" },
            "context_window": {
                "used_percentage": 42.5,
                "total_input_tokens": 12345,
                "current_usage": { "input_tokens": 100 }
            },
            "transcript_path": "/tmp/x.jsonl",
            "weird": null,
            "is_error": false
        })
    }

    #[test]
    fn navigate_nested_key_present_returns_leaf() {
        let v = fixture();
        let leaf = navigate(&v, &["context_window", "current_usage", "input_tokens"]);
        assert_eq!(leaf.and_then(Value::as_u64), Some(100));
    }

    #[test]
    fn navigate_missing_key_returns_none() {
        let v = fixture();
        assert!(navigate(&v, &["context_window", "absent"]).is_none());
    }

    #[test]
    fn navigate_empty_path_returns_root() {
        let v = fixture();
        assert!(std::ptr::eq(navigate(&v, &[]).unwrap(), &v));
    }

    #[test]
    fn typed_accessors_return_matching_values() {
        let v = fixture();
        assert_eq!(
            u64_at(&v, &["context_window", "total_input_tokens"]),
            Some(12345)
        );
        assert_eq!(
            f64_at(&v, &["context_window", "used_percentage"]),
            Some(42.5)
        );
        assert_eq!(str_at(&v, &["model", "id"]), Some("claude-opus-4"));
        assert_eq!(bool_at(&v, &["is_error"]), Some(false));
        assert!(obj_at(&v, &["model"]).is_some());
    }

    #[test]
    fn defaults_are_used_for_missing_or_wrong_types() {
        let v = fixture();
        assert_eq!(u64_or(&v, &["context_window", "used_percentage"], 9), 9);
        assert_eq!(f64_or(&v, &["missing"], 1.5), 1.5);
        assert_eq!(str_or(&v, &["weird"], "fallback"), "fallback");
        assert!(bool_or(&v, &["missing"], true));
    }

    #[test]
    fn extract_typed_struct_round_trip() {
        #[derive(serde::Deserialize, Debug, PartialEq)]
        struct Model {
            id: String,
            display_name: String,
        }

        let v = fixture();
        let model: Option<Model> = extract(&v, &["model"]);
        assert_eq!(
            model,
            Some(Model {
                id: "claude-opus-4".into(),
                display_name: "Opus 4".into(),
            })
        );
    }
}
