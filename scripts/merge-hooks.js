#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MEMORY_HOOK_COMMANDS = {
  sessionStart: [{ command: 'node ./hooks/memory-session-start.js' }],
  stop: [{ command: 'node ./hooks/memory-capture.js' }],
  sessionEnd: [{ command: 'node ./hooks/memory-capture.js' }],
};

function hookKey(entry) {
  return JSON.stringify(entry);
}

function mergeHooks(existing, fragment) {
  const merged = { version: existing.version || 1, hooks: { ...existing.hooks } };

  for (const [event, entries] of Object.entries(fragment)) {
    const current = merged.hooks[event] || [];
    const seen = new Set(current.map(hookKey));
    for (const entry of entries) {
      const key = hookKey(entry);
      if (!seen.has(key)) {
        current.push(entry);
        seen.add(key);
      }
    }
    merged.hooks[event] = current;
  }

  return merged;
}

function removeHooks(existing, fragment) {
  const merged = { version: existing.version || 1, hooks: { ...existing.hooks } };
  const removeKeys = new Set();

  for (const entries of Object.values(fragment)) {
    for (const entry of entries) {
      removeKeys.add(hookKey(entry));
    }
  }

  for (const [event, entries] of Object.entries(merged.hooks)) {
    merged.hooks[event] = entries.filter((entry) => !removeKeys.has(hookKey(entry)));
    if (merged.hooks[event].length === 0) delete merged.hooks[event];
  }

  return merged;
}

function readHooks(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { version: 1, hooks: {} };
  }
}

function writeHooks(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function main() {
  const action = process.argv[2];
  const hooksPath = path.join(os.homedir(), '.cursor', 'hooks.json');

  if (action === 'install') {
    const next = mergeHooks(readHooks(hooksPath), MEMORY_HOOK_COMMANDS);
    writeHooks(hooksPath, next);
    console.log('Merged memory hooks into', hooksPath);
    return;
  }

  if (action === 'uninstall') {
    const next = removeHooks(readHooks(hooksPath), MEMORY_HOOK_COMMANDS);
    writeHooks(hooksPath, next);
    console.log('Removed memory hooks from', hooksPath);
    return;
  }

  console.error('Usage: node merge-hooks.js <install|uninstall>');
  process.exit(1);
}

main();
