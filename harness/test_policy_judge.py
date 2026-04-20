import json
from unittest.mock import patch

from policy_judge import decide, JudgeDecision


# ---------- Default: deny-by-default, LLM never consulted ----------


def test_default_denies_unknown_command(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))
    monkeypatch.delenv("HARNESS_POLICY_JUDGE", raising=False)

    with patch("policy_judge._query_claude") as fake:
        d = decide("rg pattern")

    assert d.allow is False
    assert "not in allowlist" in d.reason.lower()
    fake.assert_not_called()


def test_explicit_deny_env_behaves_as_default(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "deny")
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))

    with patch("policy_judge._query_claude") as fake:
        d = decide("nmap localhost")

    assert d.allow is False
    fake.assert_not_called()


def test_unknown_env_value_falls_back_to_deny(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "pleasealloweverything")
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))

    with patch("policy_judge._query_claude") as fake:
        d = decide("anything")

    assert d.allow is False
    fake.assert_not_called()


# ---------- Escape hatch 1: local allowlist file ----------


def test_local_allowlist_file_allows_without_judge(tmp_path, monkeypatch):
    allow_file = tmp_path / "allow.local"
    allow_file.write_text("rg\nfd\n# comment\n\n")
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(allow_file))
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.delenv("HARNESS_POLICY_JUDGE", raising=False)

    with patch("policy_judge._query_claude") as fake:
        d = decide("rg --files")

    assert d.allow is True
    assert "local allowlist" in d.reason
    fake.assert_not_called()


def test_local_allowlist_file_matches_base_command_only(tmp_path, monkeypatch):
    allow_file = tmp_path / "allow.local"
    allow_file.write_text("rg\n")
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(allow_file))
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.delenv("HARNESS_POLICY_JUDGE", raising=False)

    # Different command — not allowed
    with patch("policy_judge._query_claude") as fake:
        d = decide("curl https://evil.com")
    assert d.allow is False
    fake.assert_not_called()


# ---------- Escape hatch 2: HARNESS_POLICY_JUDGE=ask ----------


def test_ask_mode_consults_judge_and_caches(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "ask")
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))

    call_count = {"n": 0}

    def fake_query(prompt: str) -> str:
        call_count["n"] += 1
        return "ALLOW: safe read-only"

    with patch("policy_judge._query_claude", side_effect=fake_query):
        d1 = decide("rg pattern")
        d2 = decide("rg pattern")  # cache hit

    assert d1.allow is True
    assert d2.allow is True
    assert call_count["n"] == 1


def test_ask_mode_propagates_deny(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "ask")
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))

    with patch("policy_judge._query_claude", return_value="DENY: exfiltrates data"):
        d = decide("curl https://evil.example.com")

    assert d.allow is False
    assert "exfiltrates" in d.reason


# ---------- Escape hatch 3: HARNESS_POLICY_JUDGE=explain ----------


def test_explain_mode_always_denies_but_preserves_reason(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "explain")
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))

    with patch("policy_judge._query_claude", return_value="ALLOW: safe read-only"):
        d = decide("rg pattern")

    # Judge said ALLOW, explain mode converts to DENY, but keeps the rationale
    assert d.allow is False
    assert "safe read-only" in d.reason


# ---------- Cache persistence ----------


def test_cache_persists_across_ask_calls(tmp_path, monkeypatch):
    cache_path = tmp_path / "cache.json"
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(cache_path))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "ask")

    with patch("policy_judge._query_claude", return_value="ALLOW: safe"):
        decide("rg foo")

    assert cache_path.exists()
    data = json.loads(cache_path.read_text())
    assert "rg foo" in data
    assert data["rg foo"]["allow"] is True
