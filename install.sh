#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURSOR_DIR="${CURSOR_DIR:-$HOME/.cursor}"
LINK=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [--link]

Install cursor-memory into ~/.cursor (user-global).

Options:
  --link    Symlink hooks/skills from this repo (dev mode) instead of copying
  -h, --help  Show this help

Requirements:
  - Node.js (hooks run via node)
  - cursor CLI on PATH (background consolidate)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --link) LINK=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found" >&2
  exit 1
fi

MEMORY_HOOKS=(
  memory-lib.js
  memory-git.js
  memory-session-start.js
  memory-capture.js
  memory-extract-runner.js
  memory-consolidate-runner.js
)

MEMORY_SKILLS=(
  memory-read
  memory-extract
  memory-consolidate
  memory-feedback
)

install_file() {
  local src="$1"
  local dest="$2"

  mkdir -p "$(dirname "$dest")"

  if [[ "$LINK" == true ]]; then
    if [[ -e "$dest" || -L "$dest" ]]; then
      rm -f "$dest"
    fi
    ln -s "$src" "$dest"
    echo "linked $dest -> $src"
    return
  fi

  if [[ -L "$dest" ]]; then
    rm -f "$dest"
  fi

  if [[ -f "$dest" ]]; then
    cp "$src" "$dest"
    echo "updated $dest"
    return
  fi

  cp "$src" "$dest"
  echo "copied $dest"
}

install_path() {
  local src="$1"
  local dest="$2"

  mkdir -p "$(dirname "$dest")"

  if [[ "$LINK" == true ]]; then
    if [[ -e "$dest" || -L "$dest" ]]; then
      rm -rf "$dest"
    fi
    ln -s "$src" "$dest"
    echo "linked $dest -> $src"
    return
  fi

  if [[ -d "$dest" || -L "$dest" ]]; then
    rm -rf "$dest"
    cp -R "$src" "$dest"
    echo "updated $dest"
    return
  fi

  cp -R "$src" "$dest"
  echo "copied $dest"
}

echo "Installing cursor-memory from $REPO_DIR"

mkdir -p "$CURSOR_DIR/hooks" "$CURSOR_DIR/skills"

for hook in "${MEMORY_HOOKS[@]}"; do
  install_file "$REPO_DIR/src/hooks/$hook" "$CURSOR_DIR/hooks/$hook"
done

for skill in "${MEMORY_SKILLS[@]}"; do
  install_path "$REPO_DIR/skills/$skill" "$CURSOR_DIR/skills/$skill"
done

mkdir -p "$CURSOR_DIR/memory/raw/stage1" "$CURSOR_DIR/memory/raw/processed" "$CURSOR_DIR/memory/rollout_summaries" "$CURSOR_DIR/memory/state"

for template in memory_summary.md MEMORY.md raw_memories.md; do
  dest="$CURSOR_DIR/memory/$template"
  if [[ ! -f "$dest" ]]; then
    cp "$REPO_DIR/templates/memory/$template" "$dest"
    echo "initialized $dest"
  else
    echo "keep existing $dest"
  fi
done

node "$REPO_DIR/scripts/merge-hooks.js" install

cat > "$CURSOR_DIR/memory/state/install.json" <<EOF
{
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "repoDir": "$REPO_DIR",
  "linkMode": $LINK
}
EOF

if command -v cursor >/dev/null 2>&1; then
  echo "cursor CLI: $(command -v cursor)"
else
  echo "warn: cursor CLI not on PATH — background consolidate will fail until installed"
fi

echo ""
echo "Done. Restart Cursor or reload hooks (save hooks.json) if hooks do not fire."
echo "Logs: ~/.cursor/memory/state/capture.log and consolidate.log"
echo "Doctor: $REPO_DIR/scripts/doctor.sh"
