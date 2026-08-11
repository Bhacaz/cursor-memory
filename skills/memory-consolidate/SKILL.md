---
name: memory-consolidate
description: >-
  Phase 2: merge stage-1 extractions into durable MEMORY.md and memory_summary.md
  using git workspace diff. Invoked by background consolidate runner only.
disable-model-invocation: true
---

# Memory consolidate (Phase 2)

Background maintenance. Integrate new extractions into durable artifacts.

## Primary input

- `~/.cursor/memory/phase2_workspace_diff.md` — git diff since last baseline
- Read this first to find what changed (INCREMENTAL mode)

## Also read

- `raw_memories.md` — merged stage-1 outputs
- `MEMORY.md` — current registry
- `memory_summary.md` — must start with `v1`
- `rollout_summaries/*.md` — per-rollout evidence

## Procedure

1. Read `phase2_workspace_diff.md` — focus on added/changed `raw_memories.md` and `rollout_summaries/` entries first.
2. For each new/changed raw memory, apply the **generality gate** before promoting to `MEMORY.md`:
   - **Promote** — prefs, conventions, naming rules, migration patterns, tooling defaults that apply beyond one bug/ticket
   - **Rollout only** — keep `rollout_summaries/<slug>.md` for session audit; do **not** add a registry bullet
   - **Drop** — one-ticket fixes, single-component quirks, investigation notes with no reusable lesson
3. Merge duplicates aggressively — one canonical bullet per fact.
4. Prune existing registry bullets that fail the generality gate (one-off bugs that slipped through earlier).
5. Update `memory_summary.md`:
   - Must start with exact line `v1`
   - Keep 1–2 screens max — navigational keywords + pointers only
   - Regenerate completely if missing or not `v1`
6. Deletion hygiene: if diff shows removed rollout summaries, remove `MEMORY.md` bullets supported only by deleted evidence.
7. Do **not** archive stage-1 files or reset git — the runner handles that after you finish.

## High signal (keep)

- Reusable prefs, repo conventions, proven workflow shortcuts
- Implicit preferences inferred from user steering patterns
- Failure shields that prevented repeat mistakes
- Repo orientation, tooling quirks discovered during work

## Reject (drop from registry)

- Secrets, credentials, tokens, API keys
- Generic advice, one-off trivia, brainstorming never adopted
- Content from AGENTS.md, hooks, or skill instruction blocks
- Verbose raw tool output
- One-off bug root causes (single API field mismatch, one component's data shape, ticket-specific investigation)
- "How we fixed X once" without a reusable repo-wide or user-wide pattern

## Scope (strict)

- Write only under `~/.cursor/memory/`
- Never create or modify skills; skill authoring requires an explicit user request
- Do not run shell commands or access network
- Do not read transcripts or spawn sub-agents

## Verification

- [ ] `memory_summary.md` starts with `v1`
- [ ] No secrets in any memory file
- [ ] Diff-driven changes applied; no unrelated edits
