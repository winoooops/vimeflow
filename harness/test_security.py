"""Tests for gh subcommand validation."""

from security import validate_gh_command, extract_commands


def test_gh_pr_create_allowed():
    assert validate_gh_command("gh pr create --title 'test' --body 'body'") == (True, "")


def test_gh_pr_view_allowed():
    assert validate_gh_command("gh pr view --json number") == (True, "")


def test_gh_pr_list_allowed():
    assert validate_gh_command("gh pr list --head my-branch") == (True, "")


def test_gh_api_get_comments_allowed():
    assert validate_gh_command("gh api repos/owner/repo/issues/1/comments") == (True, "")


def test_gh_auth_status_allowed():
    assert validate_gh_command("gh auth status") == (True, "")


def test_gh_pr_close_blocked():
    ok, reason = validate_gh_command("gh pr close 1")
    assert not ok
    assert "not allowed" in reason.lower()


def test_gh_pr_merge_blocked():
    ok, reason = validate_gh_command("gh pr merge 1")
    assert not ok


def test_gh_repo_delete_blocked():
    ok, reason = validate_gh_command("gh repo delete owner/repo")
    assert not ok


def test_gh_api_delete_blocked():
    ok, reason = validate_gh_command("gh api -X DELETE repos/owner/repo/issues/1")
    assert not ok


def test_gh_api_put_blocked():
    ok, reason = validate_gh_command("gh api -X PUT repos/owner/repo")
    assert not ok


def test_gh_api_patch_blocked():
    ok, reason = validate_gh_command("gh api -X PATCH repos/owner/repo")
    assert not ok


def test_gh_issue_delete_blocked():
    ok, reason = validate_gh_command("gh issue delete 1")
    assert not ok


def test_gh_release_blocked():
    ok, reason = validate_gh_command("gh release create v1.0")
    assert not ok


def test_gh_unknown_subcommand_blocked():
    ok, reason = validate_gh_command("gh workflow run deploy")
    assert not ok


def test_gh_api_post_blocked():
    ok, reason = validate_gh_command("gh api -X POST repos/owner/repo/issues/1/comments")
    assert not ok


def test_gh_api_data_flag_f_blocked():
    ok, reason = validate_gh_command("gh api repos/owner/repo/issues -f title=test")
    assert not ok
    assert "data flag" in reason.lower()


def test_gh_api_data_flag_field_blocked():
    ok, reason = validate_gh_command("gh api repos/owner/repo/issues --field body=hello")
    assert not ok


def test_gh_api_data_flag_input_blocked():
    ok, reason = validate_gh_command("gh api repos/owner/repo/issues --input data.json")
    assert not ok


def test_gh_api_data_flag_combined_form_blocked():
    ok, reason = validate_gh_command("gh api repos/owner/repo/issues --field=title=test")
    assert not ok


def test_gh_api_data_flag_f_equals_blocked():
    ok, reason = validate_gh_command("gh api repos/owner/repo/issues -f=body=hello")
    assert not ok


def test_gh_api_combined_method_xpost_blocked():
    ok, reason = validate_gh_command("gh api -XPOST repos/owner/repo/issues")
    assert not ok


def test_gh_api_method_equals_post_blocked():
    ok, reason = validate_gh_command("gh api --method=POST repos/owner/repo")
    assert not ok


def test_gh_repo_view_allowed():
    assert validate_gh_command("gh repo view --json nameWithOwner") == (True, "")


def test_extract_commands_includes_gh():
    cmds = extract_commands("gh pr create --title 'test'")
    assert "gh" in cmds
