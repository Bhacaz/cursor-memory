#!/usr/bin/env bash
# Safe diagnostic bundle for cursor-memory feedback issues.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CURSOR_DIR="${CURSOR_DIR:-$HOME/.cursor}"
MEMORY_DIR="$CURSOR_DIR/memory"

section() { echo ""; echo "## $1"; echo ""; }

echo "# cursor-memory diagnostics"
echo "generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

section "Package"
if [[ -f "$REPO_DIR/package.json" ]]; then
  node -e "const p=require('$REPO_DIR/package.json'); console.log('name:', p.name); console.log('version:', p.version);"
fi
echo "node: $(node -v 2>/dev/null || echo missing)"
echo "cursor: $(command -v cursor 2>/dev/null || echo missing)"
echo "git: $(command -v git 2>/dev/null || echo missing)"
echo "gh: $(command -v gh 2>/dev/null || echo missing)"

section "Install state"
if [[ -f "$MEMORY_DIR/state/install.json" ]]; then
  cat "$MEMORY_DIR/state/install.json"
else
  echo "(no install.json)"
fi

section "Doctor"
if [[ -x "$REPO_DIR/scripts/doctor.sh" ]]; then
  "$REPO_DIR/scripts/doctor.sh" || true
else
  echo "(doctor.sh missing)"
fi

section "Capture state"
if [[ -f "$MEMORY_DIR/state/last-capture.json" ]]; then
  cat "$MEMORY_DIR/state/last-capture.json"
else
  echo "(no last-capture.json)"
fi

stage1=0
if [[ -d "$MEMORY_DIR/raw/stage1" ]]; then
  stage1=$(find "$MEMORY_DIR/raw/stage1" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
fi
echo "stage-1 files: $stage1"

section "capture.log (last 15)"
if [[ -f "$MEMORY_DIR/state/capture.log" ]]; then
  tail -15 "$MEMORY_DIR/state/capture.log"
else
  echo "(empty)"
fi

section "extract.log (last 15)"
if [[ -f "$MEMORY_DIR/state/extract.log" ]]; then
  tail -15 "$MEMORY_DIR/state/extract.log"
else
  echo "(empty)"
fi

section "consolidate.log (last 15)"
if [[ -f "$MEMORY_DIR/state/consolidate.log" ]]; then
  tail -15 "$MEMORY_DIR/state/consolidate.log"
else
  echo "(empty)"
fi
