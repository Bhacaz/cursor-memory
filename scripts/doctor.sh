#!/usr/bin/env bash
set -euo pipefail

CURSOR_DIR="${CURSOR_DIR:-$HOME/.cursor}"
MEMORY_DIR="$CURSOR_DIR/memory"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAIL=0

ok() { echo "ok  $1"; }
bad() { echo "FAIL $1"; FAIL=1; }
warn() { echo "warn $1"; }

echo "cursor-memory doctor"
echo "repo: $REPO_DIR"
echo ""

check_link() {
  local dest="$1"
  local label="$2"
  if [[ ! -e "$dest" && ! -L "$dest" ]]; then
    bad "$label missing: $dest"
    return
  fi
  if [[ -L "$dest" ]] && [[ ! -e "$dest" ]]; then
    bad "$label broken symlink: $dest -> $(readlink "$dest" 2>/dev/null || echo '?')"
    return
  fi
  ok "$label"
}

for hook in memory-lib.js memory-session-start.js memory-capture.js; do
  check_link "$CURSOR_DIR/hooks/$hook" "hook $hook"
done

for skill in memory-read memory-consolidate; do
  check_link "$CURSOR_DIR/skills/$skill" "skill $skill"
done

if node "$CURSOR_DIR/hooks/memory-session-start.js" <<< '{}' | grep -q 'additional_context'; then
  ok "sessionStart hook runs"
else
  bad "sessionStart hook failed or returned empty"
fi

if command -v cursor >/dev/null 2>&1; then
  ok "cursor CLI: $(command -v cursor)"
else
  warn "cursor CLI not on PATH — background consolidate will fail"
fi

if [[ -f "$MEMORY_DIR/raw/pending.jsonl" ]]; then
  pending=$(grep -c . "$MEMORY_DIR/raw/pending.jsonl" 2>/dev/null || echo 0)
else
  pending=0
fi
echo ""
echo "pending captures: $pending (consolidate at ${MEMORY_CONSOLIDATE_THRESHOLD:-3})"

if [[ -f "$MEMORY_DIR/state/last-capture.json" ]]; then
  echo "last capture state:"
  cat "$MEMORY_DIR/state/last-capture.json"
else
  warn "no last-capture.json yet — hooks may not have fired"
fi

echo ""
if [[ -f "$MEMORY_DIR/state/capture.log" ]]; then
  echo "capture.log (last 5):"
  tail -5 "$MEMORY_DIR/state/capture.log"
else
  warn "no capture.log yet — finish an agent chat and check again"
fi

echo ""
if [[ -f "$MEMORY_DIR/state/consolidate.log" ]]; then
  echo "consolidate.log (last 5):"
  tail -5 "$MEMORY_DIR/state/consolidate.log"
fi

echo ""
if [[ "$FAIL" -ne 0 ]]; then
  echo "Fix: cd $REPO_DIR && ./install.sh --link"
  exit 1
fi

echo "Hooks look healthy. Memory only updates on high-signal user messages (always/never/remember/corrections)."
echo "Test: tell agent 'always use pnpm not npm' then end chat — watch capture.log."
