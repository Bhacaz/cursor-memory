#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  CURSOR_DIR,
  clearExtractLock,
  clearExtractQueued,
  countStage1,
  isExtractInProgress,
  isExtractLockStale,
  logExtract,
  readCaptureState,
  recoverStaleExtract,
  stage1LockPath,
  stage1OutputPath,
  triggerBackgroundExtract,
} = require('../src/hooks/memory-lib.js');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { clearStuck: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--session' && args[i + 1]) { out.sessionId = args[++i]; continue; }
    if (args[i] === '--transcript' && args[i + 1]) { out.transcriptPath = args[++i]; continue; }
    if (args[i] === '--cwd' && args[i + 1]) { out.cwd = args[++i]; continue; }
    if (args[i] === '--clear-stuck') { out.clearStuck = true; continue; }
    if (args[i] === '--help' || args[i] === '-h') { out.help = true; continue; }
  }
  return out;
}

function usage() {
  console.log(`Usage: node memory-retry-extract.js --session <id> [--transcript <path>] [--cwd <dir>]
       node memory-retry-extract.js --clear-stuck

Clears stale extract locks/queued flags and re-runs Phase 1 extraction.`);
}

function findTranscript(sessionId) {
  const roots = [
    path.join(CURSOR_DIR, 'projects'),
    path.join(os.homedir(), '.cursor', 'projects'),
  ];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const projectDir of fs.readdirSync(root)) {
      const candidate = path.join(
        root,
        projectDir,
        'agent-transcripts',
        sessionId,
        `${sessionId}.jsonl`,
      );
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function clearStuckSessions() {
  const state = readCaptureState();
  let cleared = 0;

  for (const [sessionId, sessionState] of Object.entries(state.sessions || {})) {
    if (recoverStaleExtract(sessionId, sessionState)) cleared += 1;
    const lockPath = stage1LockPath(sessionId);
    if (fs.existsSync(lockPath) && isExtractLockStale(lockPath)) {
      clearExtractLock(sessionId);
      cleared += 1;
      logExtract(`cleared stale lock session=${sessionId}`);
    }
    if (sessionState.extractQueued && !isExtractInProgress(sessionId, sessionState)) {
      clearExtractQueued(sessionId, 'manual-clear');
      cleared += 1;
      logExtract(`cleared stuck extractQueued session=${sessionId}`);
    }
  }

  console.log(`cleared ${cleared} stuck extract state(s)`);
}

function main() {
  const opts = parseArgs();
  if (opts.help) {
    usage();
    return;
  }

  if (opts.clearStuck) {
    clearStuckSessions();
    return;
  }

  if (!opts.sessionId) {
    usage();
    process.exit(1);
  }

  const sessionId = opts.sessionId;
  const transcriptPath = opts.transcriptPath || findTranscript(sessionId);
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    console.error(`transcript not found for session ${sessionId}`);
    console.error('pass --transcript <path> or ensure agent-transcripts/<session>/<session>.jsonl exists');
    process.exit(1);
  }

  clearExtractLock(sessionId);
  clearExtractQueued(sessionId, 'manual-retry');

  const cwd = opts.cwd || process.cwd();
  const runner = path.join(CURSOR_DIR, 'hooks', 'memory-extract-runner.js');
  console.log(`retry extract session=${sessionId}`);
  console.log(`transcript=${transcriptPath}`);

  const child = spawn(process.execPath, [
    runner,
    '--transcript', transcriptPath,
    '--session', sessionId,
    '--cwd', cwd,
    '--outcome', 'success',
  ], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('close', (code) => {
    console.log(`extract-runner exit=${code} stage1=${countStage1()}`);
    process.exit(code ?? 1);
  });
}

main();
