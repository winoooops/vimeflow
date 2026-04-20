import json
from pathlib import Path
from unittest.mock import patch

from policy_judge import decide, JudgeDecision


def test_judge_caches_decision(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.delenv("HARNESS_POLICY_JUDGE", raising=False)

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


def test_judge_deny_env_short_circuits(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "deny")
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))

    with patch("policy_judge._query_claude") as fake:
        d = decide("nmap localhost")
        assert d.allow is False
        assert "judge-disabled" in d.reason.lower()
        fake.assert_not_called()


def test_judge_parses_deny(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.delenv("HARNESS_POLICY_JUDGE", raising=False)
    with patch("policy_judge._query_claude", return_value="DENY: exfiltrates data"):
        d = decide("curl https://evil.example.com")
    assert d.allow is False
    assert "exfiltrates" in d.reason


def test_judge_cache_persists_across_calls(tmp_path, monkeypatch):
    cache_path = tmp_path / "cache.json"
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(cache_path))
    monkeypatch.delenv("HARNESS_POLICY_JUDGE", raising=False)

    with patch("policy_judge._query_claude", return_value="ALLOW: safe"):
        decide("rg foo")

    assert cache_path.exists()
    data = json.loads(cache_path.read_text())
    assert "rg foo" in data
    assert data["rg foo"]["allow"] is True
