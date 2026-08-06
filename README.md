# cursor-memory

Codex-style **persistent memory** for [Cursor](https://cursor.com) — user-global, local-only, powered by [hooks](https://cursor.com/docs/hooks).

Captures high-signal facts from agent chats, consolidates them into Markdown, and injects a compact summary at every session start.

## How it works

```
sessionStart  → inject memory_summary.md into agent context
stop/sessionEnd → score user transcript → append raw/pending.jsonl
pending ≥ 3   → background `cursor agent -p --model composer-2.5` consolidates
```

| Layer | Role |
|-------|------|
| **Read path** | `sessionStart` hook injects `memory_summary.md` |
| **Capture** | Heuristic scoring on user messages (no LLM cost) |
| **Consolidate** | Background Cursor CLI agent merges into `MEMORY.md` |
| **Skills** | `memory-read` + `memory-consolidate` guide the agent |

Inspired by the memory system in [openai/codex](https://github.com/openai/codex).

## Requirements

- Cursor with hooks enabled
- **Node.js** ≥ 18 (hooks run via `node`)
- **`cursor` CLI** on PATH (`cursor agent …` for background consolidate)

## Install

```bash
git clone <this-repo> ~/code/cursor-memory   # or your path
cd ~/code/cursor-memory
chmod +x install.sh uninstall.sh
./install.sh
```

Install copies into `~/.cursor/`:

| Source | Destination |
|--------|-------------|
| `src/hooks/*` | `~/.cursor/hooks/` |
| `skills/*` | `~/.cursor/skills/` |
| `templates/memory/*` | `~/.cursor/memory/` (only if missing) |
| hook entries | merged into `~/.cursor/hooks.json` |

Existing `hooks.json` entries (e.g. caveman) are preserved — memory hooks are appended.

### Dev mode (symlink)

While editing this repo, symlink instead of copy:

```bash
./install.sh --link
```

Updates to `src/hooks/` and `skills/` take effect immediately.

## Uninstall

```bash
./uninstall.sh              # remove hooks + skills; keep memory data
./uninstall.sh --purge-data # also delete ~/.cursor/memory/
```

## Memory layout

After install, data lives under **`~/.cursor/memory/`** (user-global, not per-project):

```
~/.cursor/memory/
├── memory_summary.md       # line 1 must be "v1" — injected every session
├── MEMORY.md               # searchable registry
├── raw/
│   ├── pending.jsonl       # captured high-signal snippets
│   └── processed/          # archive after consolidation
├── rollout_summaries/      # distilled run histories
└── state/
    ├── consolidate.log     # background job output
    ├── consolidate.lock    # in-flight guard
    └── last-capture.json   # transcript cursor per conversation
```

Skills installed to `~/.cursor/skills/memory-read/` and `memory-consolidate/`.

## What gets captured

**High signal** (score ≥ 2):

- User corrections — *"use pnpm not npm"*
- Explicit prefs — *"always…"*, *"never…"*, *"remember…"*
- Repeatable workflow hints

**Rejected:**

- Secrets / credentials / tokens
- Generic advice, one-off trivia
- Embedded instruction blocks (`AGENTS.md`, skills, hooks)

## Consolidation

When `pending.jsonl` reaches **3** entries and a chat completes, a **detached** agent runs:

```bash
cursor agent -p --force --trust --model composer-2.5 --workspace ~/.cursor \
  "Consolidate pending memories per ~/.cursor/skills/memory-consolidate/SKILL.md …"
```

Runs outside your chat — no follow-up message spam. Check `~/.cursor/memory/state/consolidate.log` for progress.

### Manual consolidate

```bash
cursor agent -p --model composer-2.5 --trust --workspace ~/.cursor \
  "Consolidate pending memories per ~/.cursor/skills/memory-consolidate/SKILL.md"
```

## Configuration

Environment variables (optional):

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_CONSOLIDATE_THRESHOLD` | `3` | Pending entries before consolidate |
| `MEMORY_CONSOLIDATE_MODEL` | `composer-2.5` | Model for background consolidate |
| `MEMORY_CONSOLIDATE_DEBOUNCE_MS` | `60000` | Min ms between consolidate spawns |
| `MEMORY_LOCK_STALE_MS` | `1800000` | Stale lock timeout (30 min) |
| `MEMORY_CURSOR_BIN` | auto-detect | Path to `cursor` binary |

Set in shell profile or wrap hook commands if needed.

## Verify

1. Open a **new** agent chat — memory summary should appear in context.
2. Say something high-signal: *"always use pnpm not npm"*.
3. Complete the chat — check `~/.cursor/memory/raw/pending.jsonl`.
4. After 3 captures — `consolidate.log` should show a spawn line.
5. Cursor **Customize → Hooks** tab + Hooks output channel for debug.

## Repository structure

```
cursor-memory/
├── README.md
├── install.sh / uninstall.sh
├── hooks.fragment.json     # reference hook entries
├── package.json
├── src/hooks/                # runtime hook scripts
│   ├── memory-lib.js
│   ├── memory-session-start.js
│   └── memory-capture.js
├── scripts/
│   └── merge-hooks.js        # install/uninstall hooks.json merge
├── skills/
│   ├── memory-read/
│   └── memory-consolidate/
└── templates/memory/         # starter Markdown files
```

## Hook entries added

See `hooks.fragment.json`. Merged into your existing `~/.cursor/hooks.json`:

- `sessionStart` → `memory-session-start.js`
- `stop` → `memory-capture.js`
- `sessionEnd` → `memory-capture.js`

## License

MIT
