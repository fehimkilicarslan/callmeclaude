import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEMINI_KEY_MISSING, geminiKeyMissingText } from '../src/secrets.ts';
import { classifySecretLookup, parseBusctlBool } from '../src/platform/linux.ts';
import { darwin } from '../src/platform/darwin.ts';

test('macOS: the missing-key text is byte-for-byte unchanged, whatever the state', () => {
  assert.equal(GEMINI_KEY_MISSING, 'No Gemini API key. Run `cmc setup --gemini-key <KEY>`.');
  for (const s of [undefined, 'missing', 'locked', 'unreachable', 'unknown'] as const) assert.equal(geminiKeyMissingText('darwin', s), GEMINI_KEY_MISSING);
  assert.equal(darwin.secrets.diagnose, undefined);
});

test('Linux: a key that was never stored keeps the old text', () => {
  assert.equal(geminiKeyMissingText('linux', 'missing'), GEMINI_KEY_MISSING);
  assert.equal(geminiKeyMissingText('linux', undefined), GEMINI_KEY_MISSING);
});

test('Linux: a locked or unreachable keyring says it unlocks at login', () => {
  assert.equal(
    geminiKeyMissingText('linux', 'locked'),
    'The voice key is in the keyring, which is locked: it unlocks when you log in to the computer. Log in once, then call again.',
  );
  for (const s of ['unreachable', 'unknown'] as const) {
    const t = geminiKeyMissingText('linux', s);
    assert.match(t, /unlocks when you log in to the computer/);
    assert.match(t, /cmc setup --gemini-key <KEY>/, 'still says how to store one');
    assert.doesNotMatch(t, /^No Gemini API key/);
  }
});

test('secret-tool lookup outcomes', () => {
  assert.equal(classifySecretLookup({ status: 0, stdout: 'AIza…\n', stderr: '' }), 'found');
  // A private D-Bus session without any Secret Service (the hub before the desktop login):
  assert.equal(classifySecretLookup({ status: 1, stdout: '', stderr: 'secret-tool: The name org.freedesktop.secrets was not provided by any .service files\n' }), 'unreachable');
  assert.equal(classifySecretLookup({ status: 1, stdout: '', stderr: 'secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY' }), 'unreachable');
  assert.equal(classifySecretLookup({ status: 1, stdout: '', stderr: 'secret-tool: Cannot get secret of a locked object' }), 'locked');
  // Silent exit 1: the collection's Locked property decides; unreadable = cannot tell.
  assert.equal(classifySecretLookup({ status: 1, stdout: '', stderr: '', locked: true }), 'locked');
  assert.equal(classifySecretLookup({ status: 1, stdout: '', stderr: '', locked: false }), 'missing');
  assert.equal(classifySecretLookup({ status: 1, stdout: '', stderr: '' }), 'unknown');
  assert.equal(parseBusctlBool('b true\n'), true);
  assert.equal(parseBusctlBool('b false'), false);
  assert.equal(parseBusctlBool(''), undefined);
});
