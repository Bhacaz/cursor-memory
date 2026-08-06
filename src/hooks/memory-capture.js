#!/usr/bin/env node
'use strict';

const {
  CONSOLIDATE_THRESHOLD,
  captureFromTranscript,
  countPending,
  readStdin,
  shouldTriggerConsolidate,
  triggerBackgroundConsolidate,
} = require('./memory-lib.js');

function main() {
  const input = readStdin();
  const hookEvent = input.hook_event_name || 'unknown';

  captureFromTranscript(input, hookEvent);

  if (shouldTriggerConsolidate(input, hookEvent)) {
    const pending = countPending();
    if (pending >= CONSOLIDATE_THRESHOLD) {
      triggerBackgroundConsolidate();
    }
  }

  process.stdout.write('{}');
}

main();
