import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apnsTexts } from '../src/apns.ts';

test('macOS APNs texts are byte-for-byte unchanged', () => {
  assert.deepEqual(apnsTexts('darwin'), {
    setupMissing:
      '⚠️  APNs not configured (the hub can only ring the phone while the app is open): cmc setup --apns-key-file AuthKey_XXX.p8 --apns-key-id XXX --team-id XXX --bundle-id XXX',
    doctorName: 'APNs (hub can ring the phone)',
    doctorMissing: '!not configured',
  });
});

test('Linux APNs texts: only iPhones need APNs to ring in the background, Android is not affected', () => {
  const t = apnsTexts('linux');
  assert.match(t.setupMissing, /an iPhone rings only while the CallMeClaude app is open/);
  assert.match(t.setupMissing, /the Android app is not affected/);
  assert.ok(t.setupMissing.endsWith(': cmc setup --apns-key-file AuthKey_XXX.p8 --apns-key-id XXX --team-id XXX --bundle-id XXX'));
  assert.ok(!t.setupMissing.includes('the hub can only ring the phone'));
  assert.equal(t.doctorName, 'APNs (hub can ring an iPhone in the background)');
  assert.ok(t.doctorMissing.startsWith('!not configured'));
  assert.match(t.doctorMissing, /Android app is not affected/);
});
