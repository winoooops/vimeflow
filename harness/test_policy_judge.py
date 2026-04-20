import asyncio
import json
from unittest.mock import AsyncMock, patch

from policy_judge import decide


def _run(coro):
    return asyncio.run(coro)


# ---------- Default: deny-by-default, LLM never consulted ----------


def test_default_denies_unknown_command(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))
    monkeypatch.delenv("HARNESS_POLICY_JUDGE", raising=False)

    with patch("policy_judge._query_claude", new=AsyncMock()) as fake:
        d = _run(decide("rg pattern"))

    assert d.allow is False
    assert "not in allowlist" in d.reason.lower()
    fake.assert_not_called()


def test_explicit_deny_env_behaves_as_default(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "deny")
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))

    with patch("policy_judge._query_claude", new=AsyncMock()) as fake:
        d = _run(decide("nmap localhost"))

    assert d.allow is False
    fake.assert_not_called()


def test_unknown_env_value_falls_back_to_deny(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "pleasealloweverything")
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))

    with patch("policy_judge._query_claude", new=AsyncMock()) as fake:
        d = _run(decide("anything"))

    assert d.allow is False
    fake.assert_not_called()


# ---------- Escape hatch 1: local allowlist file ----------


def test_local_allowlist_file_allows_without_judge(tmp_path, monkeypatch):
    allow_file = tmp_path / "allow.local"
    allow_file.write_text("rg\nfd\n# comment\n\n")
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(allow_file))
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.delenv("HARNESS_POLICY_JUDGE", raising=False)

    with patch("policy_judge._query_claude", new=AsyncMock()) as fake:
        d = _run(decide("rg --files"))

    assert d.allow is True
    assert "local allowlist" in d.reason
    fake.assert_not_called()


def test_local_allowlist_file_matches_base_command_only(tmp_path, monkeypatch):
    allow_file = tmp_path / "allow.local"
    allow_file.write_text("rg\n")
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(allow_file))
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.delenv("HARNESS_POLICY_JUDGE", raising=False)

    with patch("policy_judge._query_claude", new=AsyncMock()) as fake:
        d = _run(decide("curl https://evil.com"))
    assert d.allow is False
    fake.assert_not_called()


# ---------- Escape hatch 2: HARNESS_POLICY_JUDGE=ask ----------


def test_ask_mode_consults_judge_and_caches(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "ask")
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))

    fake = AsyncMock(return_value="ALLOW: safe read-only")
    with patch("policy_judge._query_claude", new=fake):
        d1 = _run(decide("rg pattern"))
        d2 = _run(decide("rg pattern"))  # cache hit

    assert d1.allow is True
    assert d2.allow is True
    assert fake.await_count == 1


def test_ask_mode_propagates_deny(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "ask")
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))

    with patch("policy_judge._query_claude", new=AsyncMock(return_value="DENY: exfiltrates data")):
        d = _run(decide("curl https://evil.example.com"))

    assert d.allow is False
    assert "exfiltrates" in d.reason


# ---------- Escape hatch 3: HARNESS_POLICY_JUDGE=explain ----------


def test_explain_mode_always_denies_but_preserves_reason(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "explain")
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))

    with patch("policy_judge._query_claude", new=AsyncMock(return_value="ALLOW: safe read-only")):
        d = _run(decide("rg pattern"))

    # Judge said ALLOW, explain mode converts to DENY, keeps the rationale.
    assert d.allow is False
    assert "safe read-only" in d.reason


# ---------- Cache persistence ----------


def test_cache_persists_across_ask_calls(tmp_path, monkeypatch):
    """Cache key is whatever was passed to decide(). Callers (security.py)
    pass a base command name like "rg", not the full invocation, so the
    approval granularity is per-binary."""
    cache_path = tmp_path / "cache.json"
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(cache_path))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "ask")

    with patch("policy_judge._query_claude", new=AsyncMock(return_value="ALLOW: safe")):
        _run(decide("rg"))

    assert cache_path.exists()
    data = json.loads(cache_path.read_text())
    assert "rg" in data
    assert data["rg"]["allow"] is True


# ---------- Regression: brace in command doesn't blow up .format ----------


def test_ask_mode_command_with_braces_does_not_raise(tmp_path, monkeypatch):
    """`decide("{oops}")` must not raise KeyError from .format interpretation.
    Pre-fix: JUDGE_PROMPT.format(command=...) saw the inner braces as placeholders."""
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "ask")
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))

    with patch("policy_judge._query_claude", new=AsyncMock(return_value="DENY: synthetic")):
        d = _run(decide("{weird}"))
    assert d.allow is False


# ---------- LLM response parsing ----------


def test_ask_mode_parses_allow_even_with_preamble(tmp_path, monkeypatch):
    """Pre-fix: the parser only looked at raw_lines[0]. An LLM preamble
    like "Sure, here's my decision:" would fall through the ALLOW prefix
    test and silently become a DENY. Post-fix: scan all lines for the
    first ALLOW/DENY."""
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "ask")
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(tmp_path / "cache.json"))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))

    verbose = "Sure, here's my decision:\n\nALLOW: safe read-only dev tool"
    with patch("policy_judge._query_claude", new=AsyncMock(return_value=verbose)):
        d = _run(decide("rg"))

    assert d.allow is True
    assert "safe read-only" in d.reason


def test_ask_mode_deny_not_cached(tmp_path, monkeypatch):
    """A DENY must not be cached — a hallucinated or transient DENY would
    otherwise lock the command out permanently with no recovery UX."""
    cache_path = tmp_path / "cache.json"
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "ask")
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(cache_path))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))

    with patch("policy_judge._query_claude", new=AsyncMock(return_value="DENY: suspicious")):
        d = _run(decide("weirdtool"))

    assert d.allow is False
    # Cache file may not exist at all, or exists with no entry for weirdtool
    if cache_path.exists():
        data = json.loads(cache_path.read_text())
        assert "weirdtool" not in data


def test_ask_mode_allow_is_cached(tmp_path, monkeypatch):
    """Sanity: ALLOW decisions ARE still cached (the whole point of the
    cache is to avoid re-consulting the LLM for known-safe binaries)."""
    cache_path = tmp_path / "cache.json"
    monkeypatch.setenv("HARNESS_POLICY_JUDGE", "ask")
    monkeypatch.setenv("HARNESS_POLICY_CACHE", str(cache_path))
    monkeypatch.setenv("HARNESS_POLICY_ALLOW_FILE", str(tmp_path / "allow.local"))

    with patch("policy_judge._query_claude", new=AsyncMock(return_value="ALLOW: safe")):
        _run(decide("rg"))

    assert cache_path.exists()
    data = json.loads(cache_path.read_text())
    assert data.get("rg", {}).get("allow") is True


# ---------- User-private cache default ----------


def test_cache_default_is_user_home_not_world_writable_tmp(tmp_path, monkeypatch):
    """`/tmp/harness_policy_cache.json` is world-writable, which lets any
    local account poison decisions. Default falls back to
    ~/.claude/harness_policy_cache.json instead."""
    monkeypatch.delenv("HARNESS_POLICY_CACHE", raising=False)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)

    from policy_judge import _cache_path
    path = _cache_path()
    # Path.home() is absolute on all platforms.
    assert str(path).startswith(str(__import__("pathlib").Path.home()))
    assert ".claude" in path.parts
    assert "tmp" not in path.parts or path.parts[1] != "tmp"
