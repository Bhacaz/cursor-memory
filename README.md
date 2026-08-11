# cursor-memory

Codex-style **persistent memory** for [Cursor](https://cursor.com) — user-global, local-only, powered by [hooks](https://cursor.com/docs/hooks).

Extracts learnings from agent transcripts with **GPT-5.6 Luna**, consolidates via git workspace diff, injects compact summary at every session start.

See [docs/codex-memory-reference.md](docs/codex-memory-reference.md) for full Codex architecture reference.

## How it works

```
sessionStart     → inject memory_summary.md into agent context
stop/sessionEnd  → cadence + generation + transcript-mtime gates
                 → spawn Luna extract (sandbox) on changed transcript
                 → write raw/stage1/<session>.json + rollout_summaries/
                 → sync raw_memories.md + git diff
stage1 ≥ 3       → spawn sandboxed consolidate agent on phase2_workspace_diff.md
                 → update MEMORY.md + memory_summary.md → git baseline commit
```

| Layer | Role |
|-------|------|
| **Read path** | `sessionStart` hook injects `memory_summary.md` |
| **Extract (Phase 1)** | Luna (`gpt-5.6-luna-high`) reads full transcript — explicit + implicit learnings |
| **Consolidate (Phase 2)** | Sandboxed agent merges via git workspace diff |
| **Skills** | `memory-read`, `memory-extract`, `memory-consolidate` |

Inspired by the memory system in [openai/codex](https://github.com/openai/codex).

## Requirements

- Cursor with hooks enabled
- **Node.js** ≥ 18 (hooks run via `node`)
- **`cursor` CLI** on PATH (`cursor agent …` for background extract/consolidate)
- **`git`** on PATH (workspace diff baseline)

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

Re-running `./install.sh` is safe: hooks and skills are refreshed; `MEMORY.md` and other memory data are never overwritten.

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
├── memory_summary.md           # line 1 must be "v1" — injected every session
├── MEMORY.md                   # searchable registry
├── raw_memories.md             # merged stage-1 outputs (Phase 2 input)
├── phase2_workspace_diff.md    # git diff for consolidate (ephemeral)
├── .git/                       # single-commit baseline for diffs
├── raw/
│   ├── stage1/<session>.json   # Luna extraction output
│   └── processed/                # archive after consolidation
├── rollout_summaries/          # per-rollout distilled evidence
└── state/
    ├── capture.log
    ├── extract.log
    ├── consolidate.log
    ├── transcript-index.json
    ├── consolidate.lock
    └── last-capture.json
```

Skills installed to `~/.cursor/skills/memory-read/`, `memory-extract/`, `memory-consolidate/`, `memory-feedback/`.

## What gets captured

**Phase 1 (Luna)** reads the full transcript and extracts:

- Explicit prefs — *"always…"*, *"never…"*, corrections
- **Implicit learnings** — repeated steering, failure shields, repo orientation, tooling quirks
- Task outcomes and rollout summaries

**Rejected:**

- Secrets / credentials / tokens
- Generic advice, one-off trivia
- Embedded instruction blocks (`AGENTS.md`, skills, hooks)
- One-off bug investigations (single ticket, single component/API quirk, no reusable pattern)

No-op when nothing would change future agent behavior.
Repeatable workflows stay in memory; this system never creates skills automatically.

## Capture cadence

Extraction requires:

- 10 completed top-level turns since the previous extraction
- 120 minutes since the previous extraction
- a transcript mtime newer than `state/transcript-index.json`

Repeated `generation_id` hook events are ignored. Successful and no-op extractions
both advance the transcript index; failed extractions remain retryable.

## Consolidation

When `raw/stage1/` reaches **3** entries and git workspace is dirty after sync:

1. Sync `raw_memories.md` from stage-1 JSON files
2. Write `phase2_workspace_diff.md` (git diff vs baseline)
3. Spawn **sandboxed** consolidate agent (Luna by default)
4. Archive stage-1 files, commit new git baseline

Runs outside your chat. Check `~/.cursor/memory/state/extract.log` and `consolidate.log`.

### Manual retry (stuck extract)

If extract wedges on stale lock or `extractQueued`:

```bash
npm run retry-extract -- --clear-stuck
npm run retry-extract -- --session <conversation-id> [--cwd <project-dir>]
```


```bash
cursor agent -p --sandbox enabled --model gpt-5.6-luna-high --workspace ~/.cursor/memory \
  "Consolidate pending memories per ~/.cursor/skills/memory-consolidate/SKILL.md"
```

Or run the runner directly:

```bash
node ~/.cursor/hooks/memory-consolidate-runner.js
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_MODEL` | `gpt-5.6-luna-high` | Model for extract + consolidate |
| `MEMORY_CONSOLIDATE_THRESHOLD` | `3` | Stage-1 files before consolidate |
| `MEMORY_CAPTURE_MIN_TURNS` | `10` | Completed top-level turns before extract |
| `MEMORY_CAPTURE_MIN_MINUTES` | `120` | Minimum minutes between extracts |
| `MEMORY_SANDBOX` | `enabled` | Sandbox mode for background agents |
| `MEMORY_CONSOLIDATE_DEBOUNCE_MS` | `60000` | Min ms between consolidate spawns |
| `MEMORY_LOCK_STALE_MS` | `1800000` | Stale lock timeout (30 min) |
| `MEMORY_CURSOR_BIN` | auto-detect | Path to `cursor` binary |

Set in shell profile or wrap hook commands if needed.

## Verify

1. Open a **new** agent chat — memory summary should appear in context.
2. Complete a coding chat with reusable learnings.
3. Check `~/.cursor/memory/state/extract.log` and `raw/stage1/`.
4. After 3 extractions — `consolidate.log` should show a spawn line.
5. Cursor **Customize → Hooks** tab + Hooks output channel for debug.

```bash
./scripts/doctor.sh
```

## Feedback

File **sanitized** public issues from any agent session:

1. Invoke skill **`memory-feedback`** (or ask agent to file cursor-memory feedback)
2. Agent runs `npm run feedback`, **rewrites** diagnostics by hand (no company paths, names, or secrets)
3. You approve preview → `gh issue create` on `Bhacaz/cursor-memory`

Issue templates: **Memory quality** (captures/consolidate) and **Ops / install bug**. Skill blocks company names, internal URLs, ticket IDs, secrets, and real project paths.

Requires `gh auth login`. Override target repo with `MEMORY_FEEDBACK_REPO=owner/repo`.

```bash
npm run feedback   # raw diagnostics for agent to summarize (do not paste verbatim into issues)
```

## Repository structure

```
cursor-memory/
├── README.md
├── docs/codex-memory-reference.md   # Codex architecture reference
├── install.sh / uninstall.sh
├── hooks.fragment.json
├── package.json
├── src/hooks/
│   ├── memory-lib.js
│   ├── memory-git.js
│   ├── memory-session-start.js
│   ├── memory-capture.js
│   ├── memory-extract-runner.js
│   └── memory-consolidate-runner.js
├── scripts/
│   ├── merge-hooks.js
│   └── doctor.sh
├── skills/
│   ├── memory-read/
│   ├── memory-extract/
│   └── memory-consolidate/
└── templates/memory/
```

## Hook entries added

See `hooks.fragment.json`. Merged into your existing `~/.cursor/hooks.json`:

- `sessionStart` → `memory-session-start.js`
- `stop` → `memory-capture.js`
- `sessionEnd` → `memory-capture.js`

## Troubleshooting

### Nothing updates after moving the repo

`./install.sh --link` creates symlinks. **Moving the folder breaks them.**

```bash
cd ~/Documents/code/cursor-memory
./install.sh --link
./scripts/doctor.sh
```

### Memory files not growing

Extraction runs after the capture cadence is met, via Luna on the changed full transcript.

1. Capture state: `~/.cursor/memory/state/last-capture.json`
2. Transcript index: `~/.cursor/memory/state/transcript-index.json`
3. Stage-1 queue: `~/.cursor/memory/raw/stage1/*.json`
4. Consolidate at **3** stage-1 files when git diff is dirty
5. `MEMORY.md` updates only after consolidate

```bash
tail -f ~/.cursor/memory/state/extract.log
```

If you see `skip: no transcript_path`, enable transcripts in Cursor settings.

### Doctor

```bash
./scripts/doctor.sh
```

## License

MIT
