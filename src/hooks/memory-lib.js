#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  prepareWorkspaceDiff,
  resetGitBaseline,
  archiveConsolidatedStage1,
  syncRawMemoriesMd,
} = require('./memory-git.js');

const CURSOR_DIR = path.join(os.homedir(), '.cursor');
const MEMORY_DIR = path.join(CURSOR_DIR, 'memory');
const STAGE1_DIR = path.join(MEMORY_DIR, 'raw', 'stage1');
const PROCESSED_DIR = path.join(MEMORY_DIR, 'raw', 'processed');
const STATE_DIR = path.join(MEMORY_DIR, 'state');
const CAPTURE_STATE_PATH = path.join(STATE_DIR, 'last-capture.json');
const TRANSCRIPT_INDEX_PATH = path.join(STATE_DIR, 'transcript-index.json');
const LOCK_PATH = path.join(STATE_DIR, 'consolidate.lock');
const CONSOLIDATE_LOG = path.join(STATE_DIR, 'consolidate.log');
const CAPTURE_LOG = path.join(STATE_DIR, 'capture.log');
const EXTRACT_LOG = path.join(STATE_DIR, 'extract.log');
const CONSOLIDATE_SKILL = path.join(CURSOR_DIR, 'skills', 'memory-consolidate', 'SKILL.md');
const EXTRACT_SKILL = path.join(CURSOR_DIR, 'skills', 'memory-extract', 'SKILL.md');

const MEMORY_MODEL = process.env.MEMORY_MODEL
  || process.env.MEMORY_EXTRACT_MODEL
  || process.env.MEMORY_CONSOLIDATE_MODEL
  || 'gpt-5.6-luna-high';
const CONSOLIDATE_THRESHOLD = Number(process.env.MEMORY_CONSOLIDATE_THRESHOLD || 3);
const LOCK_STALE_MS = Number(process.env.MEMORY_LOCK_STALE_MS || 30 * 60 * 1000);
const EXTRACT_LOCK_STALE_MS = Number(process.env.MEMORY_EXTRACT_LOCK_STALE_MS || 15 * 60 * 1000);
const EXTRACT_QUEUED_STALE_MS = Number(process.env.MEMORY_EXTRACT_QUEUED_STALE_MS || 20 * 60 * 1000);
const CONSOLIDATE_DEBOUNCE_MS = Number(process.env.MEMORY_CONSOLIDATE_DEBOUNCE_MS || 60 * 1000);
const CAPTURE_MIN_TURNS = positiveInt(process.env.MEMORY_CAPTURE_MIN_TURNS, 10);
const CAPTURE_MIN_MINUTES = positiveInt(process.env.MEMORY_CAPTURE_MIN_MINUTES, 120);
const SANDBOX_MODE = process.env.MEMORY_SANDBOX || 'enabled';
const LAST_CONSOLIDATE_TRIGGER_PATH = path.join(STATE_DIR, 'last-consolidate-trigger.json');

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readStdin() {
  try {
    if (process.stdin.isTTY) return {};
    const raw = fs.readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function ensureDirs() {
  fs.mkdirSync(STAGE1_DIR, { recursive: true });
  fs.mkdirSync(path.join(MEMORY_DIR, 'rollout_summaries'), { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, filePath);
}

function readMemorySummary() {
  const summaryPath = path.join(MEMORY_DIR, 'memory_summary.md');
  try {
    const text = fs.readFileSync(summaryPath, 'utf8');
    if (!text.startsWith('v1')) return null;
    return text.trim();
  } catch {
    return null;
  }
}

function shouldSkipTranscript(text) {
  if (!text || text.length < 8) return true;
  if (/password|api[_-]?key|secret|token|credential|BEGIN (RSA |OPENSSH )?PRIVATE KEY/i.test(text)) {
    return true;
  }
  return false;
}

function resolveCursorBinary() {
  if (process.env.MEMORY_CURSOR_BIN) return process.env.MEMORY_CURSOR_BIN;
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'cursor'),
    '/usr/local/bin/cursor',
    'cursor',
  ];
  for (const candidate of candidates) {
    if (candidate === 'cursor') return candidate;
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // try next
    }
  }
  return 'cursor';
}

function isLockStale() {
  try {
    const stat = fs.statSync(LOCK_PATH);
    return Date.now() - stat.mtimeMs > LOCK_STALE_MS;
  } catch {
    return true;
  }
}

function clearLock() {
  try { fs.unlinkSync(LOCK_PATH); } catch { /* ignore */ }
}

function logLine(logPath, message) {
  ensureDirs();
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(logPath, line, 'utf8');
}

function logConsolidate(message) {
  logLine(CONSOLIDATE_LOG, message);
}

function logCapture(message) {
  logLine(CAPTURE_LOG, message);
}

function logExtract(message) {
  logLine(EXTRACT_LOG, message);
}

function shouldDebounceConsolidate() {
  const last = readJson(LAST_CONSOLIDATE_TRIGGER_PATH, { at: 0 });
  return Date.now() - (last.at || 0) < CONSOLIDATE_DEBOUNCE_MS;
}

function markConsolidateTriggered() {
  writeJsonAtomic(LAST_CONSOLIDATE_TRIGGER_PATH, { at: Date.now() });
}

function countStage1() {
  try {
    return fs.readdirSync(STAGE1_DIR).filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

function runAgentSync({ prompt, model, workspace, addDirs = [], sandbox, logPath, label }) {
  return new Promise((resolve) => {
    const cursorBin = resolveCursorBinary();
    const args = [
      'agent', '-p', '--force',
      '--model', model,
      '--workspace', workspace,
      '--sandbox', sandbox,
      prompt,
    ];

    for (const dir of addDirs) {
      args.splice(args.length - 1, 0, '--add-dir', dir);
    }

    const logFd = fs.openSync(logPath, 'a');
    logLine(logPath, `${label} spawn model=${model} sandbox=${sandbox}`);

    const child = spawn(cursorBin, args, {
      stdio: ['ignore', logFd, logFd],
      env: process.env,
    });

    child.on('close', (code) => {
      try { fs.closeSync(logFd); } catch { /* ignore */ }
      logLine(logPath, `${label} exit code=${code}`);
      resolve(code === 0);
    });

    child.on('error', (err) => {
      try { fs.closeSync(logFd); } catch { /* ignore */ }
      logLine(logPath, `${label} error: ${err.message}`);
      resolve(false);
    });
  });
}

function runAgentDetached({ prompt, model, workspace, addDirs = [], sandbox, logPath, label }) {
  const cursorBin = resolveCursorBinary();
  const args = [
    'agent', '-p', '--force',
    '--model', model,
    '--workspace', workspace,
    '--sandbox', sandbox,
    prompt,
  ];

  for (const dir of addDirs) {
    args.splice(args.length - 1, 0, '--add-dir', dir);
  }

  const logFd = fs.openSync(logPath, 'a');

  try {
    const child = spawn(cursorBin, args, {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: process.env,
    });
    child.unref();
    logLine(logPath, `${label} spawned pid=${child.pid} model=${model} sandbox=${sandbox}`);
    return true;
  } catch (err) {
    try { fs.closeSync(logFd); } catch { /* ignore */ }
    logLine(logPath, `${label} spawn failed: ${err.message}`);
    return false;
  }
}

async function runBackgroundAgent(opts) {
  if (opts.sync) {
    return runAgentSync(opts);
  }
  return runAgentDetached(opts);
}

function readCaptureState() {
  return readJson(CAPTURE_STATE_PATH, {
    sessions: {},
    turnsSinceLastRun: 0,
    lastRunAtMs: 0,
  });
}

function saveCaptureState(state) {
  writeJsonAtomic(CAPTURE_STATE_PATH, state);
}

function readTranscriptIndex() {
  const index = readJson(TRANSCRIPT_INDEX_PATH, { version: 1, transcripts: {} });
  return index.version === 1 && index.transcripts
    ? index
    : { version: 1, transcripts: {} };
}

function isTranscriptAdvanced(transcriptPath, mtimeMs, index = readTranscriptIndex()) {
  const entry = index.transcripts[path.resolve(transcriptPath)];
  return !entry || mtimeMs > entry.mtimeMs;
}

function isDuplicateGeneration(input, sessionState) {
  return Boolean(
    input.generation_id
    && input.generation_id === sessionState.lastProcessedGenerationId,
  );
}

function markTranscriptProcessed(transcriptPath, mtimeMs, sessionId) {
  const index = readTranscriptIndex();
  for (const indexedPath of Object.keys(index.transcripts)) {
    if (!fs.existsSync(indexedPath)) delete index.transcripts[indexedPath];
  }
  index.transcripts[path.resolve(transcriptPath)] = {
    mtimeMs,
    sessionId,
    processedAt: new Date().toISOString(),
  };
  writeJsonAtomic(TRANSCRIPT_INDEX_PATH, index);
}

function clearExtractQueued(sessionId, reason) {
  const state = readCaptureState();
  const sessionState = state.sessions[sessionId];
  if (!sessionState) return;
  delete sessionState.extractQueued;
  delete sessionState.extractQueuedAt;
  sessionState.lastExtractStatus = reason;
  sessionState.lastExtractAt = new Date().toISOString();
  state.sessions[sessionId] = sessionState;
  saveCaptureState(state);
}

function stage1OutputPath(sessionId) {
  return path.join(STAGE1_DIR, `${sessionId}.json`);
}

function stage1LockPath(sessionId) {
  return `${stage1OutputPath(sessionId)}.lock`;
}

function isExtractLockStale(lockPath) {
  try {
    const stat = fs.statSync(lockPath);
    return Date.now() - stat.mtimeMs > EXTRACT_LOCK_STALE_MS;
  } catch {
    return true;
  }
}

function clearExtractLock(sessionId) {
  try { fs.unlinkSync(stage1LockPath(sessionId)); } catch { /* ignore */ }
}

function isExtractQueuedStale(sessionState) {
  if (!sessionState?.extractQueuedAt) return true;
  const queuedAt = Date.parse(sessionState.extractQueuedAt);
  if (Number.isNaN(queuedAt)) return true;
  return Date.now() - queuedAt > EXTRACT_QUEUED_STALE_MS;
}

function isExtractInProgress(sessionId, sessionState) {
  const lockPath = stage1LockPath(sessionId);
  if (fs.existsSync(stage1OutputPath(sessionId))) return false;
  if (!fs.existsSync(lockPath)) return false;
  return !isExtractLockStale(lockPath);
}

function recoverStaleExtract(sessionId, sessionState) {
  const lockPath = stage1LockPath(sessionId);
  if (fs.existsSync(lockPath) && isExtractLockStale(lockPath)) {
    clearExtractLock(sessionId);
    logCapture(`recovered stale extract lock session=${sessionId}`);
  }
  if (sessionState?.extractQueued && isExtractQueuedStale(sessionState)) {
    clearExtractQueued(sessionId, 'stale-queued');
    logCapture(`cleared stale extractQueued session=${sessionId}`);
    return true;
  }
  return false;
}

function inferSessionId(input) {
  return input.conversation_id
    || input.session_id
    || process.env.CURSOR_SESSION_ID
    || 'unknown';
}

function resolveTranscriptPath(input) {
  return input.transcript_path
    || process.env.CURSOR_TRANSCRIPT_PATH
    || null;
}

function inferOutcome(input, hookEvent) {
  if (hookEvent === 'stop') {
    return input.status === 'completed' ? 'success' : input.status || 'unknown';
  }
  if (hookEvent === 'sessionEnd') {
    return input.reason === 'completed' ? 'success' : input.reason || 'unknown';
  }
  return 'unknown';
}

function shouldCountTurn(input, hookEvent) {
  return hookEvent === 'stop'
    && input.status === 'completed'
    && (input.loop_count ?? 0) === 0;
}

function isCadenceReady(state, now = Date.now()) {
  const minutesSinceLastRun = state.lastRunAtMs
    ? (now - state.lastRunAtMs) / 60_000
    : Number.POSITIVE_INFINITY;
  return state.turnsSinceLastRun >= CAPTURE_MIN_TURNS
    && minutesSinceLastRun >= CAPTURE_MIN_MINUTES;
}

function triggerBackgroundExtract({ transcriptPath, transcriptMtimeMs, sessionId, cwd, outcome }) {
  const runner = path.join(CURSOR_DIR, 'hooks', 'memory-extract-runner.js');
  const args = [
    runner,
    '--transcript', transcriptPath,
    '--transcript-mtime', String(transcriptMtimeMs),
    '--session', sessionId,
    '--cwd', cwd,
    '--outcome', outcome,
  ];

  try {
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    logCapture(`spawned extract-runner session=${sessionId} pid=${child.pid}`);
    return true;
  } catch (err) {
    logCapture(`extract-runner spawn failed session=${sessionId}: ${err.message}`);
    return false;
  }
}

function triggerBackgroundConsolidate() {
  if (shouldDebounceConsolidate()) {
    logConsolidate('skip: debounce');
    return false;
  }
  if (fs.existsSync(LOCK_PATH) && !isLockStale()) {
    logConsolidate('skip: consolidate already running');
    return false;
  }
  clearLock();

  ensureDirs();
  fs.writeFileSync(LOCK_PATH, JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    model: MEMORY_MODEL,
  }), 'utf8');

  const runner = path.join(CURSOR_DIR, 'hooks', 'memory-consolidate-runner.js');
  try {
    const child = spawn(process.execPath, [runner], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    markConsolidateTriggered();
    logConsolidate(`spawned consolidate-runner pid=${child.pid} model=${MEMORY_MODEL} sandbox=${SANDBOX_MODE}`);
    return true;
  } catch (err) {
    clearLock();
    logConsolidate(`consolidate-runner spawn failed: ${err.message}`);
    return false;
  }
}

function maybeTriggerConsolidate(source) {
  const stage1Count = countStage1();
  const { hasChanges } = prepareWorkspaceDiff(MEMORY_DIR);

  if (stage1Count < CONSOLIDATE_THRESHOLD) {
    logConsolidate(`skip source=${source} stage1=${stage1Count}/${CONSOLIDATE_THRESHOLD}`);
    return false;
  }

  if (!hasChanges) {
    logConsolidate(`skip source=${source} stage1=${stage1Count} no workspace diff`);
    return false;
  }

  logConsolidate(`trigger source=${source} stage1=${stage1Count} diff=true`);
  return triggerBackgroundConsolidate();
}

function captureFromTranscript(input, hookEvent) {
  const transcriptPath = resolveTranscriptPath(input);
  const sessionId = inferSessionId(input);
  const cwd = process.env.CURSOR_PROJECT_DIR || process.cwd();
  const outcome = inferOutcome(input, hookEvent);
  const state = readCaptureState();
  const sessionState = state.sessions[sessionId] || {};
  const now = Date.now();

  if (isDuplicateGeneration(input, sessionState)) {
    logCapture(`event=${hookEvent} session=${sessionId} skip: duplicate generation`);
    return 0;
  }
  if (input.generation_id) {
    sessionState.lastProcessedGenerationId = input.generation_id;
  }
  if (shouldCountTurn(input, hookEvent)) {
    state.turnsSinceLastRun = (state.turnsSinceLastRun || 0) + 1;
  }
  state.sessions[sessionId] = sessionState;
  saveCaptureState(state);

  if (!transcriptPath) {
    logCapture(`event=${hookEvent} session=${sessionId} skip: no transcript_path`);
    return 0;
  }

  if (!fs.existsSync(transcriptPath)) {
    logCapture(`event=${hookEvent} session=${sessionId} skip: transcript missing at ${transcriptPath}`);
    return 0;
  }

  if (hookEvent === 'stop' && input.status !== 'completed') {
    logCapture(`event=${hookEvent} session=${sessionId} skip: session not completed`);
    return 0;
  }

  const transcriptMtimeMs = fs.statSync(transcriptPath).mtimeMs;
  if (!isTranscriptAdvanced(transcriptPath, transcriptMtimeMs)) {
    logCapture(`event=${hookEvent} session=${sessionId} skip: transcript already indexed`);
    return 0;
  }

  if (!isCadenceReady(state, now)) {
    logCapture(
      `event=${hookEvent} session=${sessionId} skip: cadence `
      + `turns=${state.turnsSinceLastRun || 0}/${CAPTURE_MIN_TURNS}`,
    );
    return 0;
  }

  recoverStaleExtract(sessionId, sessionState);

  if (isExtractInProgress(sessionId, sessionState)) {
    logCapture(`event=${hookEvent} session=${sessionId} skip: extract in progress`);
    return 0;
  }

  if (sessionState.extractQueued && !isExtractQueuedStale(sessionState)) {
    logCapture(`event=${hookEvent} session=${sessionId} skip: extract already queued`);
    return 0;
  }

  if (sessionState.extractQueued && isExtractQueuedStale(sessionState)) {
    clearExtractQueued(sessionId, 'stale-retry');
    logCapture(`event=${hookEvent} session=${sessionId} retry: stale extractQueued cleared`);
  }

  const existingStage1 = path.join(STAGE1_DIR, `${sessionId}.json`);
  if (fs.existsSync(existingStage1)) {
    logCapture(`event=${hookEvent} session=${sessionId} skip: already extracted`);
    maybeTriggerConsolidate(hookEvent);
    return 0;
  }

  try {
    const raw = fs.readFileSync(transcriptPath, 'utf8');
    if (shouldSkipTranscript(raw)) {
      markTranscriptProcessed(transcriptPath, transcriptMtimeMs, sessionId);
      state.turnsSinceLastRun = 0;
      state.lastRunAtMs = now;
      saveCaptureState(state);
      logCapture(`event=${hookEvent} session=${sessionId} skip: transcript guard`);
      return 0;
    }
  } catch {
    logCapture(`event=${hookEvent} session=${sessionId} skip: cannot read transcript`);
    return 0;
  }

  const queued = triggerBackgroundExtract({
    transcriptPath,
    transcriptMtimeMs,
    sessionId,
    cwd,
    outcome,
  });
  if (queued) {
    sessionState.extractQueued = true;
    sessionState.extractQueuedAt = new Date().toISOString();
    state.turnsSinceLastRun = 0;
    state.lastRunAtMs = now;
    state.sessions[sessionId] = sessionState;
    saveCaptureState(state);
  }

  logCapture(`event=${hookEvent} session=${sessionId} extract_queued=${queued} stage1=${countStage1()}`);
  return queued ? 1 : 0;
}

module.exports = {
  CAPTURE_STATE_PATH,
  CAPTURE_MIN_MINUTES,
  CAPTURE_MIN_TURNS,
  CAPTURE_LOG,
  CONSOLIDATE_SKILL,
  CONSOLIDATE_THRESHOLD,
  CURSOR_DIR,
  EXTRACT_LOG,
  EXTRACT_SKILL,
  EXTRACT_LOCK_STALE_MS,
  EXTRACT_QUEUED_STALE_MS,
  MEMORY_MODEL,
  LOCK_PATH,
  MEMORY_DIR,
  SANDBOX_MODE,
  TRANSCRIPT_INDEX_PATH,
  archiveConsolidatedStage1,
  captureFromTranscript,
  clearExtractLock,
  clearExtractQueued,
  countStage1,
  isExtractInProgress,
  isExtractLockStale,
  isExtractQueuedStale,
  isCadenceReady,
  isDuplicateGeneration,
  isTranscriptAdvanced,
  logCapture,
  logConsolidate,
  logExtract,
  markTranscriptProcessed,
  maybeTriggerConsolidate,
  readCaptureState,
  readMemorySummary,
  readStdin,
  recoverStaleExtract,
  resetGitBaseline,
  resolveCursorBinary,
  runBackgroundAgent,
  saveCaptureState,
  shouldCountTurn,
  stage1LockPath,
  stage1OutputPath,
  syncRawMemoriesMd,
  triggerBackgroundConsolidate,
  triggerBackgroundExtract,
};
