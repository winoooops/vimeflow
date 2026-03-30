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
    "git",
    # Process management
    "ps", "lsof", "sleep", "pkill",
    # Utilities
    "echo", "sort", "uniq", "diff", "tr", "cut", "tee",
    "xargs", "which", "env", "true", "false", "test", "date",
    # Script execution
    "init.sh", "bash", "sh",
}

COMMANDS_NEEDING_EXTRA_VALIDATION = {"pkill", "chmod", "rm"}


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


async def bash_security_hook(input_data, tool_use_id=None, context=None):
    """Pre-tool-use hook that validates bash commands using an allowlist."""
    try:
        command = input_data.get("command", "")

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
                else:
                    continue

                if not ok:
                    return {"decision": "block", "reason": reason}

        return {}  # Allow

    except Exception as e:
        return {"decision": "block", "reason": f"Security check error: {e}"}
