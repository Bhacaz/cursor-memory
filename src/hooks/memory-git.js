#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIFF_FILE = 'phase2_workspace_diff.md';
const RAW_MEMORIES_FILE = 'raw_memories.md';

function git(memoryRoot, args, options = {}) {
  return execFileSync('git', ['-C', memoryRoot, ...args], {
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
  });
}

function ensureGitBaseline(memoryRoot) {
  const gitDir = path.join(memoryRoot, '.git');
  if (!fs.existsSync(gitDir)) {
    git(memoryRoot, ['init']);
    writeGitignore(memoryRoot);
    git(memoryRoot, ['add', '-A']);
    try {
      git(memoryRoot, ['commit', '-m', 'memory baseline', '--allow-empty']);
    } catch {
      git(memoryRoot, ['commit', '-m', 'memory baseline']);
    }
    return;
  }

  try {
    git(memoryRoot, ['rev-parse', 'HEAD']);
  } catch {
    git(memoryRoot, ['add', '-A']);
    git(memoryRoot, ['commit', '-m', 'memory baseline', '--allow-empty']);
  }
}

function writeGitignore(memoryRoot) {
  const ignorePath = path.join(memoryRoot, '.gitignore');
  const content = [
    'state/',
    'raw/stage1/*.lock',
    'phase2_workspace_diff.md',
    '',
  ].join('\n');
  if (!fs.existsSync(ignorePath)) {
    fs.writeFileSync(ignorePath, content, 'utf8');
  }
}

function listStage1Files(stage1Dir) {
  try {
    return fs.readdirSync(stage1Dir)
      .filter((f) => f.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

function readStage1Entry(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function renderRawMemoriesMd(stage1Dir) {
  const files = listStage1Files(stage1Dir);
  if (files.length === 0) {
    return '# Raw memories\n\n_No pending stage-1 extractions._\n';
  }

  const blocks = [];
  for (const file of files) {
    const entry = readStage1Entry(path.join(stage1Dir, file));
    if (!entry || (!entry.raw_memory && !entry.rollout_summary)) continue;

    const sessionId = entry.session_id || file.replace(/\.json$/, '');
    blocks.push([
      `## ${sessionId}`,
      '',
      entry.raw_memory || '_No raw_memory._',
      '',
      entry.rollout_slug ? `rollout_summary_file: rollout_summaries/${entry.rollout_slug}.md` : '',
      entry.cwd ? `cwd: ${entry.cwd}` : '',
      entry.outcome ? `outcome: ${entry.outcome}` : '',
      entry.ts ? `updated_at: ${entry.ts}` : '',
      '',
      '---',
      '',
    ].filter(Boolean).join('\n'));
  }

  if (blocks.length === 0) {
    return '# Raw memories\n\n_No pending stage-1 extractions._\n';
  }

  return `# Raw memories\n\nMerged stage-1 outputs (stable session-id order).\n\n${blocks.join('\n')}`;
}

function syncRawMemoriesMd(memoryRoot) {
  const stage1Dir = path.join(memoryRoot, 'raw', 'stage1');
  const outPath = path.join(memoryRoot, RAW_MEMORIES_FILE);
  fs.mkdirSync(stage1Dir, { recursive: true });
  fs.writeFileSync(outPath, renderRawMemoriesMd(stage1Dir), 'utf8');
  return outPath;
}

function prepareWorkspaceDiff(memoryRoot) {
  ensureGitBaseline(memoryRoot);
  syncRawMemoriesMd(memoryRoot);

  const diffPath = path.join(memoryRoot, DIFF_FILE);
  let diff = '';
  try {
    diff = git(memoryRoot, ['diff', 'HEAD', '--', '.', `:!${DIFF_FILE}`]);
  } catch {
    diff = '';
  }

  if (!diff.trim()) {
    try { fs.unlinkSync(diffPath); } catch { /* ignore */ }
    return { hasChanges: false, diffPath: null };
  }

  const header = [
    '# Memory workspace diff',
    '',
    'Git diff since last successful consolidation baseline.',
    'Use this to drive INCREMENTAL updates — focus on added/changed sections first.',
    '',
    '```diff',
    diff.trimEnd(),
    '```',
    '',
  ].join('\n');

  fs.writeFileSync(diffPath, header, 'utf8');
  return { hasChanges: true, diffPath };
}

function resetGitBaseline(memoryRoot) {
  const diffPath = path.join(memoryRoot, DIFF_FILE);
  try { fs.unlinkSync(diffPath); } catch { /* ignore */ }

  ensureGitBaseline(memoryRoot);
  git(memoryRoot, ['add', '-A']);
  try {
    git(memoryRoot, ['commit', '-m', 'phase2 baseline']);
  } catch {
    // nothing to commit
  }
}

function archiveConsolidatedStage1(stage1Dir, processedDir) {
  fs.mkdirSync(processedDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '');
  const archiveDir = path.join(processedDir, stamp);
  fs.mkdirSync(archiveDir, { recursive: true });

  let moved = 0;
  for (const file of listStage1Files(stage1Dir)) {
    const src = path.join(stage1Dir, file);
    const dest = path.join(archiveDir, file);
    fs.renameSync(src, dest);
    moved += 1;
  }
  return moved;
}

module.exports = {
  DIFF_FILE,
  RAW_MEMORIES_FILE,
  archiveConsolidatedStage1,
  ensureGitBaseline,
  prepareWorkspaceDiff,
  resetGitBaseline,
  syncRawMemoriesMd,
};
