#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  MEMORY_DIR,
  MEMORY_MODEL,
  CONSOLIDATE_SKILL,
  SANDBOX_MODE,
  LOCK_PATH,
  runBackgroundAgent,
  logConsolidate,
  archiveConsolidatedStage1,
  resetGitBaseline,
} = require('./memory-lib.js');
const { prepareWorkspaceDiff } = require('./memory-git.js');

async function main() {
  const { hasChanges, diffPath } = prepareWorkspaceDiff(MEMORY_DIR);
  if (!hasChanges) {
    logConsolidate('consolidate-runner skip: no workspace changes');
    try { fs.unlinkSync(LOCK_PATH); } catch { /* ignore */ }
    process.exit(0);
  }

  const prompt = [
    'Phase 2 memory consolidation.',
    `Follow ${CONSOLIDATE_SKILL}.`,
    `Primary diff input: ${diffPath}`,
    `Memory root: ${MEMORY_DIR}`,
    'Apply INCREMENTAL updates guided by the workspace diff.',
    'Promote only generic, reusable learnings to MEMORY.md; keep one-off bug investigations in rollout summaries or drop them.',
    'Prune registry bullets that fail the generality gate.',
    'Merge duplicates aggressively. No secrets.',
    'Do not modify files outside ~/.cursor/memory/.',
  ].join(' ');

  const ok = await runBackgroundAgent({
    prompt,
    model: MEMORY_MODEL,
    workspace: MEMORY_DIR,
    sandbox: SANDBOX_MODE,
    logPath: path.join(MEMORY_DIR, 'state', 'consolidate.log'),
    label: 'consolidate',
    sync: true,
  });

  if (!ok) {
    logConsolidate('consolidate-runner failed');
    try { fs.unlinkSync(LOCK_PATH); } catch { /* ignore */ }
    process.exit(1);
  }

  const stage1Dir = path.join(MEMORY_DIR, 'raw', 'stage1');
  const processedDir = path.join(MEMORY_DIR, 'raw', 'processed');
  const moved = archiveConsolidatedStage1(stage1Dir, processedDir);
  resetGitBaseline(MEMORY_DIR);

  writeJsonAtomic(path.join(MEMORY_DIR, 'state', 'last-consolidate.json'), {
    at: new Date().toISOString(),
    archived: moved,
  });

  try { fs.unlinkSync(LOCK_PATH); } catch { /* ignore */ }
  logConsolidate(`consolidate-runner ok archived=${moved}`);
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, filePath);
}

main().catch((err) => {
  logConsolidate(`consolidate-runner error: ${err.message}`);
  try { fs.unlinkSync(LOCK_PATH); } catch { /* ignore */ }
  process.exit(1);
});
