import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { doctorLine, geminiKeySavedText, helpText, pairTexts, voipTokenTexts } from '../src/cliTexts.ts';
import { apnsTexts } from '../src/apns.ts';

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

test('macOS doctor lines are byte-for-byte unchanged', () => {
  // Same output as the old inline formatter in index.ts.
  assert.equal(doctorLine('Hooks installed', true), '✅ Hooks installed');
  assert.equal(doctorLine('Gemini API key', false), '❌ Gemini API key');
  assert.equal(doctorLine('Mode', 'away'), '✅ Mode: away');
  assert.equal(doctorLine('Tailscale', '!not connected (no access on the road)'), '❌ Tailscale: not connected (no access on the road)');

  const apns = apnsTexts('darwin');
  assert.equal(doctorLine(apns.doctorName, apns.doctorMissing), '❌ APNs (hub can ring the phone): not configured');

  const voip = voipTokenTexts('darwin');
  assert.equal(voip.doctorName, 'Phone registered (VoIP token)');
  assert.equal(doctorLine(voip.doctorName, voip.result(undefined)), '❌ Phone registered (VoIP token): not paired yet');
  assert.equal(doctorLine(voip.doctorName, voip.result({ a: {} })), '❌ Phone registered (VoIP token): no token yet');
  assert.equal(
    doctorLine(voip.doctorName, voip.result({ 'iPhone A': { voipToken: 'x' }, 'iPhone B': {} })),
    '✅ Phone registered (VoIP token): iPhone A, iPhone B',
  );
});

test('Linux doctor: a missing APNs key or VoIP token is an iPhone-only note, not ❌', () => {
  const apns = apnsTexts('linux');
  assert.equal(
    doctorLine(apns.doctorName, apns.doctorMissing),
    'ℹ️  APNs (hub can ring an iPhone in the background): not configured (the Android app does not need it)',
  );

  const voip = voipTokenTexts('linux');
  const note = 'ℹ️  iPhone registered (VoIP token): none: needed only to ring an iPhone in the background (the Android app does not use it)';
  assert.equal(doctorLine(voip.doctorName, voip.result(undefined)), note);
  assert.equal(doctorLine(voip.doctorName, voip.result({ a: {} })), note);
  // A registered iPhone is still reported as ok.
  assert.equal(doctorLine(voip.doctorName, voip.result({ 'iPhone A': { voipToken: 'x' } })), '✅ iPhone registered (VoIP token): iPhone A');
  for (const l of [doctorLine(apns.doctorName, apns.doctorMissing), note]) assert.ok(!l.includes('❌'));
});

test('default project roots: macOS list unchanged, Linux adds the common lowercase folders', async () => {
  const { projectRootCandidates } = await import('../src/platform/projectRoots.ts');
  const mac = ['Desktop/Projeler', 'Projects', 'Projeler', 'code', 'dev', 'src', 'Developer'];
  assert.deepEqual(projectRootCandidates('darwin'), mac);
  const lin = projectRootCandidates('linux');
  assert.deepEqual(lin.slice(0, mac.length), mac);
  for (const p of ['projects', 'Desktop/projects']) assert.ok(lin.includes(p), p);
});

test('Linux doctor: project roots on one line, or how to add one', async () => {
  const { projectRootsResult } = await import('../src/cliTexts.ts');
  const h = '/home/u';
  assert.equal(doctorLine('Project roots', projectRootsResult(['/home/u/projects', '/srv/code'], h, '/home/u/.callmeclaude/config.json')), '✅ Project roots: ~/projects, /srv/code');
  assert.equal(
    doctorLine('Project roots', projectRootsResult([], h, '/home/u/.callmeclaude/config.json')),
    '❌ Project roots: none, so sessions cannot be started by voice → add your project folders to "projectRoots" in ~/.callmeclaude/config.json, then systemctl --user restart dev.callmeclaude.hub',
  );
});

test('macOS cmc help is byte-for-byte unchanged (fixture generated from the previous inline template)', () => {
  assert.equal(helpText('darwin', 'Keychain', 'this Mac'), readFileSync(new URL('./fixtures/darwin-help.txt', import.meta.url), 'utf8'));
  assert.equal(geminiKeySavedText('darwin', 'Keychain'), undefined, 'macOS setup prints no new line');
});

test('Linux cmc help: the tmux line comes after the setup description', () => {
  const lines = helpText('linux', 'keyring (libsecret)', 'this computer').split('\n');
  const i = lines.findIndex((l) => l.startsWith('  setup '));
  assert.equal(lines[i + 1], '                       Install hooks + service, store keys in the keyring (libsecret)');
  assert.equal(lines[i + 2], '                       --tmux | --no-tmux: run voice-started sessions in tmux or headless (claude -p)');
  assert.ok(lines[i + 3].startsWith('  pair '));
  assert.equal(geminiKeySavedText('linux', 'keyring (libsecret)'), '✅ Gemini API key stored in the keyring (libsecret).');
});
