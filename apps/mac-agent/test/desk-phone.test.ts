import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callEndedKind, EndedCalls } from '../scripts/desk-phone-calls.ts';

test('desk phone: call.ended for its own hung-up call is silent, other calls are still reported', () => {
  const ended = new EndedCalls();
  assert.equal(callEndedKind('a', 'a', ended), 'end'); // the call in progress
  assert.equal(callEndedKind(undefined, 'a', ended), 'other');
  ended.add('a'); // Ctrl+C: endCall(true) sent call.end for "a"
  assert.equal(callEndedKind(undefined, 'a', ended), 'own'); // the hub's confirmation
  assert.equal(callEndedKind('b', 'a', ended), 'own');
  assert.equal(callEndedKind(undefined, 'z', ended), 'other');
});

test('desk phone: only the last few ended calls are remembered', () => {
  const ended = new EndedCalls(2);
  for (const id of ['a', 'b', 'c']) ended.add(id);
  assert.equal(ended.has('a'), false);
  assert.equal(ended.has('b') && ended.has('c'), true);
  ended.add('b');
  ended.add('d');
  assert.equal(ended.has('c'), false); // 'b' was refreshed, so 'c' is the oldest
  assert.equal(ended.has('b'), true);
});
