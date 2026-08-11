---
name: memory-feedback
description: >-
  File sanitized feedback as a GitHub issue on Bhacaz/cursor-memory via gh CLI.
  Use when the user wants to report cursor-memory bugs, missed captures, false
  positives, consolidate issues, or ops problems — from any project or agent
  session. Agent must redact all company names, internal URLs, proprietary
  code, and credentials before filing — never paste diagnostics raw.
disable-model-invocation: true
---

# Memory feedback

File **public** feedback on [cursor-memory](https://github.com/Bhacaz/cursor-memory). Works from any workspace. **You** redact — no sanitize script. **Never leak employer or client context.**

## Hard rules (non-negotiable)

Before any `gh issue create`:

1. **Strip company context** — no employer/client/product names, no internal hostnames, no Jira/Linear/Confluence/Slack/GitLab links, no ticket IDs (`PROJ-123`).
2. **Strip secrets** — no tokens, keys, passwords, `.env` values, JWTs, private URLs with auth.
3. **Generic paths only** — replace real project dirs with `<project-dir>`; never paste proprietary filenames or business logic.
4. **cursor-memory scope** — issue about the memory *system*, not the user's product codebase. Repro steps use generic placeholders.
5. **You sanitize title + body** — rewrite diagnostics into generic form; do not pipe logs through unchanged.
6. **User approval required** — show sanitized preview; create only after explicit yes (`create issue`, `ship it`, etc.).

If user insists on sensitive detail → refuse create; suggest private notes locally instead.

## Prerequisites

- `gh` authenticated (`gh auth status`)
- cursor-memory repo cloned locally (for diagnostics)
- Optional: `MEMORY_FEEDBACK_REPO` env (default `Bhacaz/cursor-memory`)

## Workflow

### 1. Classify

| User report | Template | Title prefix | Labels |
|-------------|----------|--------------|--------|
| Missed/false capture, MEMORY.md quality | memory-quality | `[memory]` | `feedback`, `memory-quality` |
| Hooks, extract/consolidate stuck, install | ops-bug | `[ops]` | `feedback`, `ops` |

Ask only what's missing: category, what happened, expected behavior.

### 2. Collect diagnostics (raw — for your eyes only)

Find cursor-memory install dir:

```bash
cat ~/.cursor/memory/state/install.json 2>/dev/null
```

Run feedback bundle:

```bash
cd "<cursor-memory-repo>" && npm run feedback
```

**Do not paste raw output into the issue.** Read it, then write a redacted summary (see § Sanitize by hand).

If repo unknown, skip diagnostics — do not guess paths from current project.

### 3. Draft issue body

Match GitHub template fields. Write in your own words after redaction:

**memory-quality**

```markdown
### Category
<capture-missed | capture-noise | consolidate | injection | other>

### What happened
...

### Expected behavior
...

### Steps to reproduce
...

### Diagnostics
<redacted summary — see below>
```

**ops-bug**

```markdown
### Component
<install | sessionStart | capture | extract | consolidate | doctor | other>

### What happened
...

### Expected behavior
...

### Diagnostics
<redacted summary — see below>
```

Write final draft to temp file only after sanitization pass complete.

### 4. Sanitize by hand (mandatory)

Run this on **title**, **every body section**, and **diagnostics summary** before preview.

**Remove or replace:**

| If you see | Replace with |
|------------|--------------|
| Company / client / product names | omit or `<product>` |
| `@company.com` emails | omit |
| Ticket IDs (`HUBQC-464`, `LIN-123`) | omit |
| Slack / Confluence / Jira / GitLab URLs | omit or `<internal-url>` |
| `/Users/.../company-repo/...` or `C:\Users\...` | `<project-dir>` |
| `repoDir` in install.json pointing at real path | `cursor-memory install (symlink/copy)` |
| `cwd` in last-capture.json | `<project-dir>` |
| Session / conversation UUIDs | omit unless essential for ops debug |
| Proprietary code, file names, API names from user's repo | generic description only |
| Tokens, keys, JWTs, `Bearer …` | omit entirely |

**Diagnostics section — summarize, don't dump.** Good:

```markdown
### Diagnostics
- cursor-memory 0.1.0, node 22, gh present
- stage-1 files: 2 (threshold 3)
- extract.log: last line `skip: cadence gate` (10 turns / 120 min)
- doctor: sessionStart ok, Luna model available
```

Bad: pasting full `npm run feedback` output with home paths and install.json paths.

**Self-audit before preview** — body must contain **none** of:

- [ ] Company / client / product names (except "cursor-memory")
- [ ] Internal URLs or ticket links
- [ ] Real home or project paths
- [ ] Code from user's proprietary repo
- [ ] Credentials or token-like strings

If audit fails, rewrite — do not create.

### 5. Preview (mandatory)

Show user:

- Final title
- Full sanitized body
- Target repo
- Labels

Ask: *"Create this public GitHub issue? (yes/no)"*

### 6. Create

```bash
gh issue create \
  --repo "${MEMORY_FEEDBACK_REPO:-Bhacaz/cursor-memory}" \
  --title "<sanitized title>" \
  --body-file /tmp/issue-body.md \
  --label feedback \
  --label memory-quality   # or ops
```

If label missing, retry with `--label feedback` only.

Return issue URL to user.

## Examples

**Good title:** `[memory] Extract skipped after 12 turns — cadence gate`

**Bad title:** `[memory] PetalMD HUBQC-464 memory not captured in hub-api`

**Good body snippet:** "Working in `<project-dir>` on Rails migrations; expected preference about model defaults to persist."

**Bad body snippet:** "In petalmd/hub-api after fixing HUBQC-464 see Confluence page https://..."

**Good diagnostics:** "extract.log shows cadence skip; 8 turns recorded, 120 min gate not met."

**Bad diagnostics:** raw doctor output with `/Users/jane/Documents/code/acme-api`

## Do not

- Auto-create without user approval
- Paste raw `npm run feedback`, doctor output, or logs into the issue
- Paste raw transcript or full `MEMORY.md`
- Use `--web` unless user asks — prefer CLI with body-file
- File issues about the user's product — redirect to their own tracker
- Delegate redaction to a script — you rewrite in generic terms
