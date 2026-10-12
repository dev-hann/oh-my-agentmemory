#!/usr/bin/env bash
# oh-my-agentmemory — jcode installer.
#
# Installs:
#   1. Hook entry scripts → ~/.jcode/plugins/oh-am/
#   2. Lifecycle hook registrations appended to [hooks] in ~/.jcode/config.toml
#      (array values; existing entries preserved)
#   3. Policy overlay → ~/.jcode/overlays/oh-am.md, registered under
#      [prompt] overlay_files (requires jcode with #1802)
#   4. Config → ~/.jcode/oh-am.jsonc (created with defaults if absent;
#      the opencode config is NOT migrated automatically)
#
# Usage:
#   scripts/install-jcode.sh            install / update
#   scripts/install-jcode.sh --remove   uninstall (removes what we added)
#
# Idempotent: re-running never duplicates entries (marker-based).
# Requires: bun (https://bun.sh), a running agentmemory server (default
# http://localhost:3111).

set -euo pipefail

JCODE_DIR="${HOME}/.jcode"
PLUGIN_DIR="${JCODE_DIR}/plugins/oh-am"
OVERLAY_DIR="${JCODE_DIR}/overlays"
CONFIG_TOML="${JCODE_DIR}/config.toml"
OH_AM_CONFIG="${JCODE_DIR}/oh-am.jsonc"
OVERLAY_FILE="${OVERLAY_DIR}/oh-am.md"

# Resolve the package root: prefer the globally installed npm package,
# fall back to this repo (development mode).
resolve_pkg_root() {
  local npm_global
  npm_global="$(npm root -g 2>/dev/null || true)"
  if [ -n "$npm_global" ] && [ -d "${npm_global}/oh-my-agentmemory/src/adapters/jcode" ]; then
    echo "${npm_global}/oh-my-agentmemory"
    return 0
  fi
  # bun global too, since bun is a hard dependency anyway
  local bun_global="${HOME}/.bun/install/global/node_modules/oh-my-agentmemory"
  if [ -d "${bun_global}/src/adapters/jcode" ]; then
    echo "$bun_global"
    return 0
  fi
  return 1
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if PKG_ROOT="$(resolve_pkg_root)"; then
  SRC_ROOT="${PKG_ROOT}/src"
  echo "Source: npm-installed oh-my-agentmemory (${PKG_ROOT})"
else
  SRC_ROOT="${REPO_ROOT}/src"
  echo "Source: this repo (npm package not found globally — run: npm i -g oh-my-agentmemory)"
fi
ENTRY_SRC="${SRC_ROOT}/adapters/jcode/jcode-entry.ts"
FEEDBACK_SRC="${SRC_ROOT}/adapters/jcode/oh-am-feedback.ts"

MARKER="# oh-am (managed by scripts/install-jcode.sh)"

# ── helpers ────────────────────────────────────────────────────────────────

toml_has_line() { grep -qF "$1" "$CONFIG_TOML" 2>/dev/null; }

# Append `key = [value]` under [hooks], creating the section if needed.
# Skips when the exact line already exists (idempotency).
# Append a value to `key` under [section], preserving what is already there.
#   key absent            -> key = ["value"]
#   key = ["existing"]    -> key = ["existing", "value"]
#   key = ["ours"]        -> skip (already registered)
#   key = "scalar"        -> key = ["scalar-as-is", "value"] (promote to array)
ensure_array_entry() {
  local section="$1" key="$2" value="$3"
  local rc=0
  python3 - "$CONFIG_TOML" "$section" "$key" "$value" <<'PY' || rc=$?
import os, re, sys
path, section, key, value = sys.argv[1:5]
src = open(path).read() if os.path.exists(path) else ""

# Find the target section body. Use the LAST matching section: when a config
# legitimately contains duplicate headers, the later one wins at parse time.
sec_re = re.compile(rf"(?m)^\[{re.escape(section)}\]\s*\n")
sections = list(sec_re.finditer(src))
m = sections[-1] if sections else None
nxt = re.search(r"(?m)^\[", src[m.end():]) if m else None
body_start = m.end() if m else len(src)
body_end = body_start + nxt.start() if nxt else len(src)
body = src[body_start:body_end]

key_re = re.compile(rf"(?m)^{re.escape(key)}\s*=\s*(.+?)\s*$")
km = key_re.search(body)

def parse_values(cur):
    cur = cur.strip()
    if cur.startswith("["):
        inner = cur[1 : cur.rindex("]")]
        return [v.strip().strip('"') for v in inner.split(",") if v.strip()]
    return [cur.strip('"')]

if km:
    values = parse_values(km.group(1))
    if value in values:
        sys.exit(1)  # already registered, nothing to do
    values.append(value)
    rendered = ", ".join(f'"{v}"' for v in values)
    new_line = f"{key} = [{rendered}]"
    body = body[:km.start()] + new_line + "\n" + body[km.end():]
else:
    body = f'{key} = ["{value}"]\n' + body

if m is None:
    src = src + f"\n[{section}]\n" + body
else:
    src = src[:body_start] + body + src[body_end:]
open(path, "w").write(src)
PY
  if [ $rc -eq 0 ]; then
    echo "  + ${key}"
  else
    echo "  = ${key} already registered, skipping"
  fi
}

ensure_hook_entry() {
  ensure_array_entry "hooks" "$1" "$2"
}

# Append `key = [value]` under [prompt], creating the section if needed.
ensure_prompt_entry() {
  ensure_array_entry "prompt" "$1" "$2"
}

remove_lines() {
  # Drop any line mentioning our marker or our install paths.
  if [ -f "$CONFIG_TOML" ]; then
    grep -v -F -e "$MARKER" -e "${PLUGIN_DIR}/" -e "${OVERLAY_FILE}" \
      "$CONFIG_TOML" > "${CONFIG_TOML}.tmp" || true
    mv "${CONFIG_TOML}.tmp" "$CONFIG_TOML"
  fi
}

# ── commands ───────────────────────────────────────────────────────────────

remove_all() {
  echo "Removing oh-am jcode integration..."
  remove_lines
  rm -rf "$PLUGIN_DIR"
  rm -f "$OVERLAY_FILE"
  rm -f "$OH_AM_CONFIG"
  echo "Done. jcode picks up config changes without a restart."
}

install_all() {
  for f in "$ENTRY_SRC" "$FEEDBACK_SRC"; do
    [ -f "$f" ] || { echo "missing $f — run from the repo root"; exit 1; }
  done
  command -v bun >/dev/null || { echo "bun is required (https://bun.sh)"; exit 1; }

  echo "Installing oh-am for jcode..."

  # 1. Copy scripts (plain copy — bun runs TS directly; no build step).
  mkdir -p "$PLUGIN_DIR"
  # The entry imports ./config.js — keep the jcode adapter's layout.
  mkdir -p "$PLUGIN_DIR/src/adapters/jcode" \
           "$PLUGIN_DIR/src/adapters/opencode/hooks" \
           "$PLUGIN_DIR/src/core"
  cp "$ENTRY_SRC" "$FEEDBACK_SRC" "$PLUGIN_DIR/src/adapters/jcode/"
  cp "${SRC_ROOT}/adapters/jcode/config.ts" "$PLUGIN_DIR/src/adapters/jcode/"
  cp "${SRC_ROOT}/adapters/opencode/config.ts" \
     "${SRC_ROOT}/adapters/opencode/client.ts" \
     "${SRC_ROOT}/adapters/opencode/mode.ts" \
     "${SRC_ROOT}/adapters/opencode/compaction-runner.ts" \
     "${SRC_ROOT}/adapters/opencode/compaction-deleter.ts" \
     "$PLUGIN_DIR/src/adapters/opencode/" 2>/dev/null || true
  cp -r "${SRC_ROOT}/adapters/opencode/hooks/." "$PLUGIN_DIR/src/adapters/opencode/hooks/"
  cp -r "${SRC_ROOT}/core/." "$PLUGIN_DIR/src/core/"
  mkdir -p "$PLUGIN_DIR/src/data"
  cp -r "${SRC_ROOT}/data/." "$PLUGIN_DIR/src/data/"

  echo "  + scripts → ${PLUGIN_DIR}"

  # 2. Hook registrations.
  ensure_hook_entry "session_start"     "${PLUGIN_DIR}/src/adapters/jcode/jcode-entry.ts"
  ensure_hook_entry "post_tool"         "${PLUGIN_DIR}/src/adapters/jcode/jcode-entry.ts"
  ensure_hook_entry "turn_end"          "${PLUGIN_DIR}/src/adapters/jcode/jcode-entry.ts"
  ensure_hook_entry "session_end"       "${PLUGIN_DIR}/src/adapters/jcode/jcode-entry.ts"
  ensure_hook_entry "post_tool_feedback" "${PLUGIN_DIR}/src/adapters/jcode/oh-am-feedback.ts"

  # 3. Policy overlay + [prompt] overlay_files.
  if [ ! -f "$OVERLAY_FILE" ]; then
    mkdir -p "$OVERLAY_DIR"
    cat > "$OVERLAY_FILE" <<'POLICY'
# agentmemory policy (oh-am)

Use agentmemory MCP tools proactively. These rules override default behavior.

## IMPORTANT: which memory
"memory" here means the **agentmemory MCP server** (agentmemory_* tools), NOT jcode's built-in memory tool. Built-in memory calls do NOT count.

## Recall
- Need past context (recent work, decisions, prior bugs)? Call agentmemory_search or agentmemory_recall BEFORE exploring files.
- Trivial tasks (single-file read, grep, arithmetic) skip agentmemory calls.

## Write
- After architectural or non-obvious technical decisions, call agentmemory_save (memory_save on the agentmemory server) with the decision and concepts.
- Discovered an effective or ineffective approach? Call agentmemory_lesson_save with what worked / what to avoid.
- New module, build pipeline, or project structure? Update the project_context slot.
- Unfinished work or follow-up promised? Record it in pending items before the session ends.
- Never claim "memory updated" without an actual agentmemory tool call in this turn. jcode built-in memory calls do not count.

## Crystal
- Three or more completed agentmemory actions in this session? Recall first to check for an existing crystal, then crystallize with the done action IDs.
- Pure exploration with zero file changes → skip crystallize.
POLICY
    echo "  + overlay → ${OVERLAY_FILE}"
  else
    echo "  = overlay exists, keeping user edits"
  fi
  ensure_prompt_entry "overlay_files" "$OVERLAY_FILE"

  # 4. Default config if absent.
  if [ ! -f "$OH_AM_CONFIG" ]; then
    cat > "$OH_AM_CONFIG" <<'CFG'
{
  // oh-my-agentmemory — jcode adapter config.
  // Full option list: see README.md in the oh-my-agentmemory repo.
  "url": "http://localhost:3111",
  "secret": "",
  "mode": "full",
  "healthCheckOnBoot": true,
  "healthCheckTimeoutMs": 2000,
  "healthCheckFatal": false,
  "sessionGc": { "enabled": true, "maxAgeDays": 7 },
  "debug": false
}
CFG
    echo "  + config → ${OH_AM_CONFIG}"
  else
    echo "  = config exists, keeping"
  fi

  # 5. Register the agentmemory MCP server (jcode reads ~/.jcode/mcp.json).
  if [ ! -f "${JCODE_DIR}/mcp.json" ]; then
    cat > "${JCODE_DIR}/mcp.json" <<'MCPCFG'
{
  "mcpServers": {
    "agentmemory": {
      "command": "npx",
      "args": ["-y", "@agentmemory/mcp"],
      "timeout_secs": 60
    }
  }
}
MCPCFG
    echo "  + mcp.json → ${JCODE_DIR}/mcp.json"
  elif grep -q '"agentmemory"' "${JCODE_DIR}/mcp.json" 2>/dev/null; then
    echo "  = agentmemory MCP already registered"
  else
    echo "  ! ${JCODE_DIR}/mcp.json exists without agentmemory — add it manually"
  fi

  # 6. Verify: run session_start once against the live server.
  echo "Verifying (session_start against agentmemory)..."
  if OH_AM_DEBUG=1 \
     JCODE_HOOK_EVENT=session_start \
     JCODE_HOOK_SESSION_ID="oh-am-install-check-$(date +%s)" \
     JCODE_HOOK_CWD="$PWD" \
     bun "$PLUGIN_DIR/src/adapters/jcode/jcode-entry.ts"; then
    echo "OK."
  else
    echo "Warning: verification run failed — check agentmemory server."
  fi
  echo "Done. jcode picks up config changes without a restart."
}

case "${1:-}" in
  --remove) remove_all ;;
  "") install_all ;;
  *) echo "usage: $0 [--remove]"; exit 1 ;;
esac
