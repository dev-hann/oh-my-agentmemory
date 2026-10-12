#!/usr/bin/env bash
# rtk-transform — jcode pre_tool_transform plugin.
#
# Rewrites bash commands through rtk for token savings, mirroring rtk's
# own agent hooks (hooks/claude/rtk.ts and friends upstream). jcode calls
# this synchronously before every tool call:
#
#   stdin:  the full tool-input JSON
#   env:    JCODE_HOOK_TOOL_NAME, JCODE_HOOK_SESSION_ID, JCODE_HOOK_CWD
#   stdout: replacement tool-input JSON (empty = leave input unchanged)
#
# Fail-open contract (jcode docs/HOOKS.md): empty stdout, invalid JSON,
# non-zero exit, or timeout all leave the input untouched.
#
# Depends on `rtk hook check` (rtk >= 0.49). Skips silently otherwise.

set -u

# Session-level kill switch, mirroring upstream rtk hooks.
[ "${RTK_DISABLED:-}" = "1" ] && exit 0

[ "$JCODE_HOOK_TOOL_NAME" = "bash" ] || exit 0

# Read the tool input; no stdin (shouldn't happen on this hook) → pass.
input="$(cat 2>/dev/null)" || exit 0
[ -n "$input" ] || exit 0

# Extract bash.command without a JSON parser dependency: python3 ships with
# macOS and every Linux distro jcode targets.
command=$(printf '%s' "$input" | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("command", ""))
except Exception:
    pass
') || exit 0
[ -n "$command" ] || exit 0

# rtk must be on PATH. A bare `rtk …` inside the rewritten command is what
# actually runs later, so PATH-only — same reasoning as upstream rtk hooks.
RTK_BIN="$(command -v rtk 2>/dev/null)" || exit 0
[ -x "$RTK_BIN" ] || exit 0

# Rewrite. `rtk hook check` is the dry-run of the same engine the agent
# hooks use. Guard keeps the transform well under jcode's 500ms default
# (pre_tool_transform_timeout_ms); a slow rtk = no rewrite, never a stall.
# `timeout` is GNU coreutils and absent on stock macOS — fall back to a
# background kill guard so the rewrite still works there.
rewrite_with_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 2 "$RTK_BIN" hook check -- "$@" 2>/dev/null
  else
    "$RTK_BIN" hook check -- "$@" 2>/dev/null &
    local pid=$!
    ( sleep 2; kill "$pid" 2>/dev/null ) &
    local guard=$!
    wait "$pid" 2>/dev/null
    local rc=$?
    kill "$guard" 2>/dev/null
    wait "$guard" 2>/dev/null
    return $rc
  fi
}
rewritten=$(rewrite_with_timeout $command) || exit 0

# No rewrite (rtk prints the original or a "No rewrite for:" line) → pass.
[ -n "$rewritten" ] || exit 0
[ "$rewritten" != "$command" ] || exit 0
case "$rewritten" in "No rewrite for:"*) exit 0 ;; esac

# Emit the replacement input with only the command swapped.
export RTK_REWRITTEN="$rewritten"
printf '%s' "$input" | python3 -c '
import json, sys, os
data = json.load(sys.stdin)
data["command"] = os.environ["RTK_REWRITTEN"]
print(json.dumps(data))
' || exit 0
