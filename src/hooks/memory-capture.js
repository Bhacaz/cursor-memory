#!/usr/bin/env node
'use strict';

const { captureFromTranscript, readStdin } = require('./memory-lib.js');

function main() {
  const input = readStdin();
  const hookEvent = input.hook_event_name || 'unknown';
  captureFromTranscript(input, hookEvent);
  process.stdout.write('{}');
}

main();
