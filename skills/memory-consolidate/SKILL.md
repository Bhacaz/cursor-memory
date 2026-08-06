---
name: memory-consolidate
description: >-
  Merge pending raw memory captures into durable MEMORY.md and memory_summary.md.
  Use only when explicitly asked to consolidate memories or when invoked by the
  memory capture hook background job.
disable-model-invocation: true
---

# Memory consolidate

Background maintenance job. Process **only** high-signal pending captures.

## Inputs

- Raw queue: `~/.cursor/memory/raw/pending.jsonl`
- Current registry: `~/.cursor/memory/MEMORY.md`
- Current summary: `~/.cursor/memory/memory_summary.md` (line 1 must be `v1`)

## Procedure

1. Read all lines in `pending.jsonl`. Skip entries with `score < 2`.
2. For each surviving entry, decide:
   - **Fact/preference** → merge bullet into `MEMORY.md` under `preferences`, `projects` (use `cwd`), or `procedures`
   - **Rich run history** → write `~/.cursor/memory/rollout_summaries/<YYYY-MM-DD>-<slug>.md` and link from registry
   - **Repeatable workflow** (same pattern ≥2 entries or explicit "make skill") → create/update `~/.cursor/skills/<name>/SKILL.md`
3. Merge duplicates aggressively — one canonical bullet per fact
4. Update `memory_summary.md`:
   - Must start with exact line `v1`
   - Keep 1–2 screens max — navigational keywords + pointers only
   - Regenerate completely if missing or not `v1`
5. Move processed lines to `~/.cursor/memory/raw/processed/<timestamp>.jsonl` (or delete if empty run)
6. Write `~/.cursor/memory/state/last-consolidate.json` with `{ "at": "<iso>", "processed": N }`
7. **Always** delete `~/.cursor/memory/state/consolidate.lock` when done

## High signal (keep)

- Reusable prefs, repo conventions, proven workflow shortcuts
- User corrections ("use X not Y", "always", "never")
- Failure shields that prevented repeat mistakes

## Reject (drop)

- Secrets, credentials, tokens, API keys
- Generic advice, one-off trivia, brainstorming never adopted
- Content from AGENTS.md, hooks, or skill instruction blocks
- Verbose raw tool output

## Skill promotion rules

Create skill only when:

- Procedure is clearly reusable across sessions, AND
- Steps are actionable (when to use, inputs, procedure, verification)

Skill frontmatter:

```yaml
---
name: kebab-case-name
description: Third-person WHAT + WHEN with trigger terms
disable-model-invocation: true
---
```

## Verification

- [ ] `memory_summary.md` starts with `v1`
- [ ] No secrets in any memory file
- [ ] `pending.jsonl` empty or only unprocessed high-signal lines remain
- [ ] `consolidate.lock` removed
