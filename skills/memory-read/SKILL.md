---
name: memory-read
description: >-
  Search user memory store before re-deriving conventions, deploy steps, or past
  fixes. Use when task may match saved preferences, repo patterns, infra notes,
  or repeated workflows stored in ~/.cursor/memory/.
disable-model-invocation: true
---

# Memory read

## Store

- Summary (already injected at session start): `~/.cursor/memory/memory_summary.md`
- Registry: `~/.cursor/memory/MEMORY.md`
- Evidence: `~/.cursor/memory/rollout_summaries/`
- Procedures: `~/.cursor/skills/`

## Algorithm (max ~4–6 lookup steps)

1. Skim injected `memory_summary.md` for topic keywords
2. Grep `MEMORY.md` for task-relevant terms (repo name, tool, error, workflow)
3. If registry points to rollout or skill, open **only** the 1–2 most relevant files
4. If exact evidence needed, search referenced rollout summary
5. Stop when nothing relevant or budget exhausted — proceed with task

## Do not

- Load full `MEMORY.md` into context preemptively
- Treat memory as secrets vault — never expect credentials there
- Re-specify conventions already in memory when lookup found them
