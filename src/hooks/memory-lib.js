#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CURSOR_DIR = path.join(os.homedir(), '.cursor');
const MEMORY_DIR = path.join(CURSOR_DIR, 'memory');
const RAW_PATH = path.join(MEMORY_DIR, 'raw', 'pending.jsonl');
const STATE_DIR = path.join(MEMORY_DIR, 'state');
const CAPTURE_STATE_PATH = path.join(STATE_DIR, 'last-capture.json');
const LOCK_PATH = path.join(STATE_DIR, 'consolidate.lock');
const CONSOLIDATE_LOG = path.join(STATE_DIR, 'consolidate.log');
const CONSOLIDATE_SKILL = path.join(CURSOR_DIR, 'skills', 'memory-consolidate', 'SKILL.md');

const CONSOLIDATE_THRESHOLD = Number(process.env.MEMORY_CONSOLIDATE_THRESHOLD || 3);
const CONSOLIDATE_MODEL = process.env.MEMORY_CONSOLIDATE_MODEL || 'composer-2.5';
const LOCK_STALE_MS = Number(process.env.MEMORY_LOCK_STALE_MS || 30 * 60 * 1000);
const CONSOLIDATE_DEBOUNCE_MS = Number(process.env.MEMORY_CONSOLIDATE_DEBOUNCE_MS || 60 * 1000);
const LAST_CONSOLIDATE_TRIGGER_PATH = path.join(STATE_DIR, 'last-consolidate-trigger.json');

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
  fs.mkdirSync(path.join(MEMORY_DIR, 'raw'), { recursive: true });
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

function stripUserQuery(text) {
  return text
    .replace(/<timestamp>[\s\S]*?<\/timestamp>\s*/g, '')
    .replace(/<\/?user_query>\s*/g, '')
    .trim();
}

function shouldSkip(text) {
  if (!text || text.length < 8) return true;
  if (/password|api[_-]?key|secret|token|credential|BEGIN (RSA |OPENSSH )?PRIVATE KEY/i.test(text)) {
    return true;
  }
  if (/AGENTS\.md|<skill[\s>]|SKILL\.md|hooks\.json|memory-consolidate/i.test(text)) {
    return true;
  }
  return false;
}

function scoreCandidate(text, role) {
  if (shouldSkip(text)) return -999;

  let score = 0;
  const lower = text.toLowerCase();

  if (role === 'user') {
    if (/\bremember\b|\balways\b|\bnever\b|\bdon't\b|\bstop doing\b|\bmake this a skill\b/.test(lower)) {
      score += 3;
    }
    if (/\binstead\b|\brather\b|\bwrong\b|\bnot that\b|\buse .+ not\b|\bno,?\s/.test(lower)) {
      score += 2;
    }
    if (/\bevery time\b|\bfrom now on\b|\bgoing forward\b/.test(lower)) {
      score += 2;
    }
  }

  if (text.length > 1200) score -= 1;
  if (text.length < 20) score -= 1;

  return score;
}

function extractKeywords(text) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  const unique = [];
  for (const w of words) {
    if (!unique.includes(w)) unique.push(w);
    if (unique.length >= 8) break;
  }
  return unique;
}

const STOP_WORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'will', 'would', 'should', 'could',
  'about', 'when', 'what', 'where', 'which', 'there', 'their', 'them', 'then',
  'than', 'into', 'just', 'also', 'been', 'being', 'want', 'need', 'like',
  'make', 'user', 'query', 'assistant', 'please', 'thanks',
]);

function extractTextBlocks(message) {
  if (!message?.content) return '';
  return message.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function parseTranscriptLines(transcriptPath) {
  try {
    const raw = fs.readFileSync(transcriptPath, 'utf8');
    return raw.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function parseTranscriptMessage(line) {
  try {
    const obj = JSON.parse(line);
    if (obj.type === 'turn_ended') return null;
    if (!obj.role || !obj.message) return null;
    const text = stripUserQuery(extractTextBlocks(obj.message));
    if (!text) return null;
    return { role: obj.role, text };
  } catch {
    return null;
  }
}

function readCaptureState() {
  return readJson(CAPTURE_STATE_PATH, { sessions: {} });
}

function saveCaptureState(state) {
  writeJsonAtomic(CAPTURE_STATE_PATH, state);
}

function countPending() {
  try {
    const raw = fs.readFileSync(RAW_PATH, 'utf8').trim();
    if (!raw) return 0;
    return raw.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function appendRawEntry(entry) {
  ensureDirs();
  fs.appendFileSync(RAW_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
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

function logConsolidate(message) {
  ensureDirs();
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(CONSOLIDATE_LOG, line, 'utf8');
}

function shouldDebounceConsolidate() {
  const last = readJson(LAST_CONSOLIDATE_TRIGGER_PATH, { at: 0 });
  return Date.now() - (last.at || 0) < CONSOLIDATE_DEBOUNCE_MS;
}

function markConsolidateTriggered() {
  writeJsonAtomic(LAST_CONSOLIDATE_TRIGGER_PATH, { at: Date.now() });
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
    model: CONSOLIDATE_MODEL,
  }), 'utf8');

  const prompt = [
    'Consolidate pending memories.',
    `Follow ${CONSOLIDATE_SKILL}.`,
    `Process ${RAW_PATH} only.`,
    `Write/update ${path.join(MEMORY_DIR, 'MEMORY.md')} and ${path.join(MEMORY_DIR, 'memory_summary.md')}.`,
    'Promote repeatable workflows to ~/.cursor/skills/ only when clearly reusable.',
    `Delete ${LOCK_PATH} when finished (success or failure).`,
    'Do not store secrets. Merge duplicates aggressively.',
  ].join(' ');

  const cursorBin = resolveCursorBinary();
  const logFd = fs.openSync(CONSOLIDATE_LOG, 'a');

  try {
    const { spawn } = require('child_process');
    const child = spawn(cursorBin, [
      'agent', '-p', '--force', '--trust',
      '--model', CONSOLIDATE_MODEL,
      '--workspace', CURSOR_DIR,
      prompt,
    ], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: process.env,
    });
    child.unref();
    markConsolidateTriggered();
    logConsolidate(`spawned consolidate agent model=${CONSOLIDATE_MODEL} pid=${child.pid}`);
    return true;
  } catch (err) {
    clearLock();
    logConsolidate(`spawn failed: ${err.message}`);
    try { fs.closeSync(logFd); } catch { /* ignore */ }
    return false;
  }
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

function shouldTriggerConsolidate(input, hookEvent) {
  if (hookEvent === 'stop') {
    return input.status === 'completed';
  }
  if (hookEvent === 'sessionEnd') {
    return true;
  }
  return false;
}

function captureFromTranscript(input, hookEvent) {
  const transcriptPath = resolveTranscriptPath(input);
  if (!transcriptPath) return 0;

  const sessionId = inferSessionId(input);
  const state = readCaptureState();
  const sessionState = state.sessions[sessionId] || { lastLine: 0 };
  const lines = parseTranscriptLines(transcriptPath);
  const cwd = process.env.CURSOR_PROJECT_DIR || process.cwd();
  const outcome = inferOutcome(input, hookEvent);

  let appended = 0;

  for (let i = sessionState.lastLine; i < lines.length; i += 1) {
    const parsed = parseTranscriptMessage(lines[i]);
    if (!parsed) continue;
    if (parsed.role !== 'user') continue;

    const score = scoreCandidate(parsed.text, parsed.role);
    if (score < 2) continue;

    appendRawEntry({
      ts: new Date().toISOString(),
      session_id: sessionId,
      hook: hookEvent,
      cwd,
      task: parsed.text.slice(0, 120),
      description: parsed.text.slice(0, 500),
      keywords: extractKeywords(parsed.text),
      score,
      outcome,
    });
    appended += 1;
  }

  sessionState.lastLine = lines.length;
  sessionState.lastCaptureAt = new Date().toISOString();
  state.sessions[sessionId] = sessionState;
  saveCaptureState(state);

  return appended;
}

module.exports = {
  CAPTURE_STATE_PATH,
  CONSOLIDATE_MODEL,
  CONSOLIDATE_THRESHOLD,
  LOCK_PATH,
  MEMORY_DIR,
  RAW_PATH,
  appendRawEntry,
  captureFromTranscript,
  countPending,
  readMemorySummary,
  readStdin,
  shouldTriggerConsolidate,
  triggerBackgroundConsolidate,
};
