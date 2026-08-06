#!/usr/bin/env node
'use strict';

const { readMemorySummary, readStdin } = require('./memory-lib.js');

function main() {
  readStdin();

  const summary = readMemorySummary();
  if (!summary) {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const context = [
    '## User memory (always skim before big decisions)',
    summary,
    '',
    'Lookup when task may hit saved prefs, repo patterns, or past fixes:',
    '1. Grep ~/.cursor/memory/MEMORY.md for task keywords',
    '2. Open max 1–2 linked rollout_summaries/ or ~/.cursor/skills/ files',
    '3. Stop after ~4–6 lookup steps; proceed with task',
    '4. Use memory-read skill if unsure',
  ].join('\n');

  process.stdout.write(JSON.stringify({ additional_context: context }));
}

main();
