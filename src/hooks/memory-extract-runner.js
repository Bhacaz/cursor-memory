#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  MEMORY_DIR,
  MEMORY_MODEL,
  EXTRACT_SKILL,
  SANDBOX_MODE,
  clearExtractLock,
  clearExtractQueued,
  countStage1,
  isExtractLockStale,
  logExtract,
  markTranscriptProcessed,
  maybeTriggerConsolidate,
  runBackgroundAgent,
  stage1LockPath,
  stage1OutputPath,
} = require('./memory-lib.js');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--transcript' && args[i + 1]) { out.transcriptPath = args[++i]; continue; }
    if (args[i] === '--transcript-mtime' && args[i + 1]) {
      out.transcriptMtimeMs = Number(args[++i]);
      continue;
    }
    if (args[i] === '--session' && args[i + 1]) { out.sessionId = args[++i]; continue; }
    if (args[i] === '--cwd' && args[i + 1]) { out.cwd = args[++i]; continue; }
    if (args[i] === '--outcome' && args[i + 1]) { out.outcome = args[++i]; continue; }
  }
  return out;
}

function buildExtractPrompt({ transcriptPath, sessionId, cwd, outcome, outputPath }) {
  return [
    'Phase 1 memory extraction.',
    `Follow ${EXTRACT_SKILL}.`,
    `transcript_path: ${transcriptPath}`,
    `session_id: ${sessionId}`,
    `cwd: ${cwd}`,
    `session_outcome_hint: ${outcome}`,
    `output_path: ${outputPath}`,
    'Read the transcript. Extract implicit and explicit learnings.',
    'Apply the generality gate: skip one-off bug investigations; save only reusable prefs, conventions, and patterns.',
    'Write structured JSON to output_path exactly as specified in the skill.',
    'If rollout_summary is non-empty, also write rollout_summaries/<slug>.md under ~/.cursor/memory/.',
    'Do not consolidate. Do not edit MEMORY.md or memory_summary.md.',
  ].join(' ');
}

async function main() {
  const { transcriptPath, transcriptMtimeMs, sessionId, cwd, outcome } = parseArgs();
  if (!transcriptPath || !sessionId) {
    logExtract('abort: missing transcript or session');
    process.exit(1);
  }

  if (!fs.existsSync(transcriptPath)) {
    logExtract(`abort: transcript missing session=${sessionId} path=${transcriptPath}`);
    clearExtractQueued(sessionId, 'missing-transcript');
    process.exit(1);
  }
  const processedMtimeMs = Number.isFinite(transcriptMtimeMs)
    ? transcriptMtimeMs
    : fs.statSync(transcriptPath).mtimeMs;

  const outputPath = stage1OutputPath(sessionId);
  const lockPath = stage1LockPath(sessionId);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  if (fs.existsSync(outputPath)) {
    logExtract(`skip: already extracted session=${sessionId}`);
    clearExtractQueued(sessionId, 'already-extracted');
    maybeTriggerConsolidate('extract-runner');
    return;
  }

  if (fs.existsSync(lockPath)) {
    if (!isExtractLockStale(lockPath)) {
      logExtract(`skip: extract in progress session=${sessionId}`);
      return;
    }
    clearExtractLock(sessionId);
    logExtract(`recovered stale lock session=${sessionId}`);
  }

  fs.writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    at: new Date().toISOString(),
    sessionId,
  }), 'utf8');

  const prompt = buildExtractPrompt({
    transcriptPath,
    sessionId,
    cwd: cwd || process.env.CURSOR_PROJECT_DIR || process.cwd(),
    outcome: outcome || 'unknown',
    outputPath,
  });

  const transcriptDir = path.dirname(transcriptPath);
  logExtract(`start session=${sessionId} model=${MEMORY_MODEL} transcript=${transcriptPath}`);

  let ok = false;
  try {
    ok = await runBackgroundAgent({
      prompt,
      model: MEMORY_MODEL,
      workspace: MEMORY_DIR,
      addDirs: [transcriptDir],
      sandbox: SANDBOX_MODE,
      logPath: path.join(MEMORY_DIR, 'state', 'extract.log'),
      label: `extract session=${sessionId}`,
      sync: true,
    });
  } finally {
    clearExtractLock(sessionId);
  }

  if (!ok) {
    logExtract(`failed session=${sessionId}`);
    clearExtractQueued(sessionId, 'failed');
    process.exit(1);
  }

  if (!fs.existsSync(outputPath)) {
    markTranscriptProcessed(
      transcriptPath,
      processedMtimeMs,
      sessionId,
    );
    logExtract(`noop: no output file session=${sessionId}`);
    clearExtractQueued(sessionId, 'noop');
    process.exit(0);
  }

  let entry;
  try {
    entry = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  } catch {
    logExtract(`invalid json session=${sessionId}`);
    clearExtractQueued(sessionId, 'invalid-json');
    process.exit(1);
  }

  const hasContent = Boolean(
    (entry.raw_memory && entry.raw_memory.trim())
    || (entry.rollout_summary && entry.rollout_summary.trim()),
  );

  if (!hasContent) {
    try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    markTranscriptProcessed(
      transcriptPath,
      processedMtimeMs,
      sessionId,
    );
    logExtract(`noop session=${sessionId}`);
    clearExtractQueued(sessionId, 'noop');
    process.exit(0);
  }

  markTranscriptProcessed(
    transcriptPath,
    processedMtimeMs,
    sessionId,
  );
  clearExtractQueued(sessionId, 'ok');
  logExtract(`ok session=${sessionId} stage1=${countStage1()}`);
  maybeTriggerConsolidate('extract-runner');
}

main().catch((err) => {
  logExtract(`error: ${err.message}`);
  process.exit(1);
});
