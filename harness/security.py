"""
Bash Command Security
=====================

Allowlist-based validation for bash commands.
Adapted for VIBM's Tauri/TypeScript/Rust stack.
"""

import re
import shlex

# Commands allowed for Tauri/TS/Rust development
ALLOWED_COMMANDS = {
    # File inspection
    "ls", "cat", "head", "tail", "wc", "grep", "find", "tree",
    # File operations
    "cp", "mkdir", "chmod", "mv", "rm", "touch",
    # Directory
    "pwd",
    # Node.js / frontend
    "npm", "npx", "node",
    # Rust / Tauri
    "cargo", "rustup", "rustfmt", "rustc",
    # Version control
    "git", "gh",
    # Process management
    "ps", "lsof", "sleep", "pkill",
    # Utilities
    "echo", "sort", "uniq", "diff", "tr", "cut", "tee",
    "xargs", "which", "env", "true", "false", "test", "date",
    # Script execution
    "init.sh", "bash", "sh",
}

COMMANDS_NEEDING_EXTRA_VALIDATION = {"pkill", "chmod", "rm", "gh"}


def split_command_segments(command: str) -> list[str]:
    """Split a compound command into segments on &&, ||, ;"""
    segments = re.split(r"\s*(?:&&|\|\||;)\s*", command)
    return [s.strip() for s in segments if s.strip()]


def extract_commands(command: str) -> list[str]:
    """Extract base command names from a shell command string."""
    segments = split_command_segments(command)
    commands = []

    for segment in segments:
        # Handle pipes
        piped = segment.split("|")
        for part in piped:
            part = part.strip()
            if not part:
                continue

            # Strip leading env vars (KEY=val cmd)
            part = re.sub(r"^(\w+=\S+\s+)+", "", part)

            try:
                tokens = shlex.split(part)
            except ValueError:
                tokens = part.split()

            if tokens:
                # Get base command, strip path
                base = tokens[0].rsplit("/", 1)[-1]
                if base:
                    commands.append(base)

    return commands


def validate_pkill_command(command: str) -> tuple[bool, str]:
    allowed_processes = {"node", "npm", "npx", "vite", "cargo"}
    try:
        tokens = shlex.split(command)
    except ValueError:
        tokens = command.split()

    process_name = None
    for token in tokens[1:]:
        if not token.startswith("-"):
            process_name = token
            break

    if not process_name or process_name not in allowed_processes:
        return False, f"pkill only allowed for: {', '.join(sorted(allowed_processes))}"

    return True, ""


def validate_chmod_command(command: str) -> tuple[bool, str]:
    try:
        tokens = shlex.split(command)
    except ValueError:
        tokens = command.split()

    for token in tokens[1:]:
        if not token.startswith("-") and "/" not in token and "." not in token:
            if not re.match(r"^[ugoa]*\+x$", token):
                return False, f"chmod only allowed with +x mode, got: {token}"
            return True, ""

    return True, ""


def validate_rm_command(command: str) -> tuple[bool, str]:
    if re.search(r"rm\s+(-\w*r\w*f|-\w*f\w*r)\s+/(?:\s|$)", command):
        return False, "rm -rf / is not allowed"
    return True, ""


GH_ALLOWED_PATTERNS = [
    ("pr", "create"),
    ("pr", "view"),
    ("pr", "list"),
    ("repo", "view"),
    ("api",),
    ("auth", "status"),
]

GH_BLOCKED_API_METHODS = {
    "-X DELETE", "-X PUT", "-X PATCH", "-X POST",
    "--method DELETE", "--method PUT", "--method PATCH", "--method POST",
}

# Flags that implicitly switch gh api to POST (write operations)
GH_API_DATA_FLAGS = {"-f", "-F", "--field", "--raw-field", "--input"}


def validate_gh_command(command: str) -> tuple[bool, str]:
    """Validate gh CLI commands against a strict allowlist."""
    try:
        tokens = shlex.split(command)
    except ValueError:
        tokens = command.split()

    args = [t for t in tokens if t != "gh"]

    if not args:
        return False, "Empty gh command not allowed"

    # Block explicit HTTP method overrides (both separated and combined forms)
    # e.g. -X POST, -XPOST, --method POST, --method=POST
    command_upper = command.upper()
    for blocked in GH_BLOCKED_API_METHODS:
        if blocked.upper() in command_upper:
            return False, f"gh api with {blocked} not allowed"
    # Combined forms: -XDELETE, -XPOST, --method=DELETE, etc.
    for token in args:
        token_upper = token.upper()
        if token_upper.startswith("-X") and len(token_upper) > 2 and token_upper[2:] in {"DELETE", "PUT", "PATCH", "POST"}:
            return False, f"gh api with '{token}' not allowed"
        if token_upper.startswith("--METHOD=") and token_upper.split("=", 1)[1] in {"DELETE", "PUT", "PATCH", "POST"}:
            return False, f"gh api with '{token}' not allowed"

    # Block data flags on gh api (they implicitly switch to POST)
    # Check both standalone (-f value) and combined (-f=value, --field=value) forms
    if args and args[0] == "api":
        for token in args:
            if token in GH_API_DATA_FLAGS:
                return False, f"gh api with data flag '{token}' not allowed (implies POST)"
            for flag in GH_API_DATA_FLAGS:
                if token.startswith(flag + "="):
                    return False, f"gh api with data flag '{token}' not allowed (implies POST)"

    for pattern in GH_ALLOWED_PATTERNS:
        if len(args) >= len(pattern) and tuple(args[:len(pattern)]) == pattern:
            return True, ""

    sub = " ".join(args[:2]) if len(args) >= 2 else args[0]
    return False, f"gh subcommand '{sub}' not allowed. Allowed: pr create, pr view, pr list, api (GET), auth status"


async def bash_security_hook(input_data, tool_use_id=None, context=None):
    """Pre-tool-use hook that validates bash commands using an allowlist."""
    try:
        # SDK passes full hook context; command lives in tool_input
        if isinstance(input_data, dict) and "tool_input" in input_data:
            tool_input = input_data["tool_input"]
            command = tool_input.get("command", "") if isinstance(tool_input, dict) else ""
        else:
            command = input_data.get("command", "") if isinstance(input_data, dict) else ""

        if not command or not command.strip():
            return {"decision": "block", "reason": "Empty command"}

        commands = extract_commands(command)

        if not commands:
            return {"decision": "block", "reason": "Could not parse command"}

        for cmd in commands:
            if cmd not in ALLOWED_COMMANDS:
                return {
                    "decision": "block",
                    "reason": f"Command '{cmd}' not in allowlist",
                }

        # Extra validation for sensitive commands
        for cmd in COMMANDS_NEEDING_EXTRA_VALIDATION:
            if cmd in commands:
                if cmd == "pkill":
                    ok, reason = validate_pkill_command(command)
                elif cmd == "chmod":
                    ok, reason = validate_chmod_command(command)
                elif cmd == "rm":
                    ok, reason = validate_rm_command(command)
                elif cmd == "gh":
                    ok, reason = validate_gh_command(command)
                else:
                    continue

                if not ok:
                    return {"decision": "block", "reason": reason}

        return {}  # Allow

    except Exception as e:
        return {"decision": "block", "reason": f"Security check error: {e}"}
