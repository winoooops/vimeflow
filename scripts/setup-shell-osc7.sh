#!/usr/bin/env bash
# Setup OSC 7 escape sequence for Vimeflow file explorer sync.
#
# The file explorer tracks the terminal's working directory via OSC 7.
# zsh and fish emit this by default. bash needs a PROMPT_COMMAND addition.
#
# This script is idempotent — safe to run multiple times.

set -euo pipefail

OSC7_SNIPPET='printf "\e]7;file://%s%s\a" "$HOSTNAME" "$PWD"'
MARKER="# Vimeflow OSC 7 — file explorer cwd sync"

setup_bash() {
  local rc="$HOME/.bashrc"

  if [ ! -f "$rc" ]; then
    echo "Creating $rc"
    touch "$rc"
  fi

  if grep -qF "Vimeflow OSC 7" "$rc" 2>/dev/null; then
    echo "bash: OSC 7 already configured in $rc — skipping"
    return
  fi

  cat >> "$rc" << 'BASHRC'

# Vimeflow OSC 7 — file explorer cwd sync
PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND;}"'printf "\e]7;file://%s%s\a" "$HOSTNAME" "$PWD"'
BASHRC

  echo "bash: Added OSC 7 PROMPT_COMMAND to $rc"
  echo "      Run 'source ~/.bashrc' or open a new terminal to activate."
}

check_zsh() {
  echo "zsh: OSC 7 is emitted by default (via precmd/chpwd) — no setup needed."
}

check_fish() {
  echo "fish: OSC 7 is emitted by default — no setup needed."
}

# Detect current shell
current_shell="$(basename "${SHELL:-/bin/sh}")"

case "$current_shell" in
  bash)
    setup_bash
    ;;
  zsh)
    check_zsh
    ;;
  fish)
    check_fish
    ;;
  *)
    echo "Unknown shell: $current_shell"
    echo ""
    echo "Add this to your shell's rc file to enable OSC 7:"
    echo ""
    echo "  After each command, emit: $OSC7_SNIPPET"
    echo ""
    echo "For bash-compatible shells, set PROMPT_COMMAND."
    echo "For other shells, hook into the prompt or chpwd equivalent."
    ;;
esac
