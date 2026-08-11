'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  CAPTURE_MIN_MINUTES,
  CAPTURE_MIN_TURNS,
  isCadenceReady,
  isDuplicateGeneration,
  isTranscriptAdvanced,
  shouldCountTurn,
} = require('../src/hooks/memory-lib.js');

test('capture gates on cadence, transcript changes, and generation id', () => {
  const now = Date.now();
  assert.equal(shouldCountTurn({ status: 'completed', loop_count: 0 }, 'stop'), true);
  assert.equal(shouldCountTurn({ status: 'completed', loop_count: 1 }, 'stop'), false);
  assert.equal(isCadenceReady({ turnsSinceLastRun: CAPTURE_MIN_TURNS - 1, lastRunAtMs: 0 }, now), false);
  assert.equal(isCadenceReady({
    turnsSinceLastRun: CAPTURE_MIN_TURNS,
    lastRunAtMs: now - CAPTURE_MIN_MINUTES * 60_000,
  }, now), true);

  const transcriptPath = path.resolve('/tmp/transcript.jsonl');
  const index = { transcripts: { [transcriptPath]: { mtimeMs: 100 } } };
  assert.equal(isTranscriptAdvanced(transcriptPath, 100, index), false);
  assert.equal(isTranscriptAdvanced(transcriptPath, 101, index), true);
  assert.equal(
    isDuplicateGeneration(
      { generation_id: 'generation-1' },
      { lastProcessedGenerationId: 'generation-1' },
    ),
    true,
  );
});
