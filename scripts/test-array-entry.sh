#!/usr/bin/env bash
# Unit test for ensure_array_entry in scripts/install-jcode.sh
set -e
cd /Users/langdy-42/Documents/oh-my-agentmemory
T=$(mktemp -d /tmp/oham-toml-test.XXXXXX)
trap 'rm -rf "$T"' EXIT
awk '/^ensure_array_entry\(\)/,/^ensure_hook_entry\(\)/' scripts/install-jcode.sh | sed '$d' > "$T/h.sh"
cat >> "$T/h.sh" <<'WRAP'
ensure_hook_entry() {
  ensure_array_entry "hooks" "$1" "$2"
}
ensure_prompt_entry() {
  ensure_array_entry "prompt" "$1" "$2"
}
WRAP
bash -n "$T/h.sh"
export CONFIG_TOML="$T/config.toml"
source "$T/h.sh"

echo "-- case 1: empty file"
ensure_hook_entry "post_tool" "/a/entry.ts"
echo "c1: $(grep post_tool "$CONFIG_TOML")"

echo "-- case 2: existing scalar + array from another plugin"
printf '\n[hooks]\nturn_end = "/other/plugin.sh"\npost_tool = ["/other/p.sh", "/x/y"]\n' >> "$CONFIG_TOML"
ensure_hook_entry "session_start" "/a/entry.ts"
ensure_hook_entry "turn_end" "/a/entry.ts"
ensure_hook_entry "post_tool" "/a/entry.ts"
echo "--- section:"
grep -A5 '^\[hooks\]' "$CONFIG_TOML"

echo "-- case 3: idempotency (2 more runs)"
ensure_hook_entry "post_tool" "/a/entry.ts"
ensure_hook_entry "post_tool" "/a/entry.ts"
echo "occurrences of /a/entry.ts: $(grep -c '/a/entry.ts' "$CONFIG_TOML") (expect 1)"

echo "-- case 4: [prompt] section"
ensure_prompt_entry "overlay_files" "/oh-am.md"
ensure_prompt_entry "overlay_files" "/oh-am.md"
grep -A2 '^\[prompt\]' "$CONFIG_TOML"
echo "ALL CASES DONE"
