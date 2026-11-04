import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairTexts } from '../src/cliTexts.ts';

test('macOS cmc pair texts are byte-for-byte unchanged', () => {
  assert.deepEqual(pairTexts('darwin'), {
    scan: '\nIn the CallMeClaude app tap "Pair Mac" and scan this QR code. To enter it manually:\n',
    noTailscale:
      '\n⚠️  Tailscale is not connected: to reach this Mac on the road, log in to Tailscale on the Mac and the phone, then run `cmc pair` again.',
  });
});

test('Linux cmc pair texts name the computer, never a Mac', () => {
  const t = pairTexts('linux');
  for (const s of Object.values(t)) assert.doesNotMatch(s, /\bMac\b/);
  assert.match(t.scan, /scan this QR code to pair the phone with this computer/);
  assert.match(t.noTailscale, /to reach this computer on the road, log in to Tailscale on this computer and the phone/);
  assert.ok(t.noTailscale.endsWith('then run `cmc pair` again.'));
});
