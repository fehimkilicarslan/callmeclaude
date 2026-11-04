// Linux computer use: typing through the clipboard, the input guard and the typing rules in the prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The guard writes audit lines: keep them in a throwaway hub home, never the real ~/.callmeclaude.
const home = mkdtempSync(join(process.env.CMC_TEST_TMP ?? tmpdir(), 'cmc-typing-'));
process.env.CMC_HOME = home;
mkdirSync(join(home, 'audit'), { recursive: true });

const { typeText, saveClipboard, pasteKeys } = await import('../src/platform/clipboard.ts');
const cu = await import('../src/platform/computerUse.ts');
const { guard, computerSystemPrompt } = await import('../src/brain.ts');
const { securityPatterns } = await import('../src/platform/index.ts');
const { linux } = await import('../src/platform/linux.ts');
const { darwin } = await import('../src/platform/darwin.ts');

type Call = { cmd: string; args: string[]; input?: string };

/** A fake clipboard + input device. `types`/`content` = what the clipboard holds before the call. */
function fakeDesk(o: { tool: 'wl-clipboard' | 'xclip' | 'xsel'; types?: string[]; content?: string; failPaste?: boolean }) {
  const calls: Call[] = [];
  let types = o.types ?? [];
  let content = o.content ?? '';
  const pasted: string[] = [];
  const run = async (cmd: string, args: string[], x: { input?: string } = {}) => {
    calls.push({ cmd, args, input: x.input });
    const isWrite = (cmd === 'wl-copy' && !args.includes('--clear')) || (cmd === 'xclip' && args.includes('-i')) || (cmd === 'xsel' && args.includes('--input'));
    if (isWrite) {
      content = x.input ?? '';
      types = cmd === 'wl-copy' ? ['text/plain;charset=utf-8'] : ['TARGETS', 'UTF8_STRING'];
      return { status: 0, stdout: '' };
    }
    if ((cmd === 'wl-copy' && args.includes('--clear')) || (cmd === 'xsel' && args.includes('--clear'))) {
      content = '';
      types = [];
      return { status: 0, stdout: '' };
    }
    if (cmd === 'wl-paste' && args[0] === '--list-types') return types.length ? { status: 0, stdout: types.join('\n') + '\n' } : { status: 1, stdout: '' };
    if (cmd === 'xclip' && args.includes('TARGETS')) return types.length ? { status: 0, stdout: types.join('\n') + '\n' } : { status: 1, stdout: '' };
    if (cmd === 'wl-paste' || (cmd === 'xclip' && args.includes('-o')) || (cmd === 'xsel' && args.includes('--output'))) return { status: 0, stdout: content };
    if (cmd === 'xdotool' || cmd === 'ydotool') {
      if (args[0] === 'key') {
        if (o.failPaste) return { status: 1, stdout: '' };
        pasted.push(content);
      }
      return { status: 0, stdout: '' };
    }
    return { status: 127, stdout: '' };
  };
  return { run, calls, pasted, now: () => ({ types, content }) };
}
const sleep = async () => {};

// ---------- typing through the clipboard ----------

test('Wayland: the text is pasted with Ctrl+V and the earlier clipboard text is put back', async () => {
  const desk = fakeDesk({ tool: 'wl-clipboard', types: ['text/plain;charset=utf-8', 'text/plain'], content: 'şifre değil, eski metin' });
  const r = await typeText('Merhaba, çğışöü', { clipboard: 'wl-clipboard', input: 'ydotool', run: desk.run, sleep });
  assert.equal(r.ok, true);
  assert.deepEqual(desk.pasted, ['Merhaba, çğışöü']);
  assert.equal(desk.now().content, 'şifre değil, eski metin');
  assert.equal(r.message, 'Pasted 15 characters. The clipboard was restored.');
  // Ctrl+V as Linux key codes, every key released in the same command.
  assert.ok(desk.calls.some((c) => c.cmd === 'ydotool' && c.args.join(' ') === 'key 29:1 47:1 47:0 29:0'));
  assert.ok(!desk.calls.some((c) => c.args[0] === 'type'), 'never typed key by key');
});

test('X11 (xclip): pasted with xdotool ctrl+v; an empty clipboard stays empty', async () => {
  const desk = fakeDesk({ tool: 'xclip' });
  const r = await typeText('Grüße', { clipboard: 'xclip', input: 'xdotool', run: desk.run, sleep });
  assert.deepEqual(desk.pasted, ['Grüße']);
  assert.equal(desk.now().content, '');
  assert.match(r.message, /The clipboard was empty before and is empty again\./);
  assert.ok(desk.calls.some((c) => c.cmd === 'xdotool' && c.args.join(' ') === 'key --clearmodifiers ctrl+v'));
});

test('terminal windows get Ctrl+Shift+V', () => {
  assert.deepEqual(pasteKeys('xdotool', true), ['xdotool', ['key', '--clearmodifiers', 'ctrl+shift+v']]);
  assert.deepEqual(pasteKeys('ydotool', true), ['ydotool', ['key', '29:1', '42:1', '47:1', '47:0', '42:0', '29:0']]);
});

test('non-text clipboard content (an image) cannot be put back: the agent is told to say so', async () => {
  const desk = fakeDesk({ tool: 'wl-clipboard', types: ['image/png'], content: '\x89PNG' });
  assert.deepEqual(await saveClipboard('wl-clipboard', desk.run), { kind: 'other', types: ['image/png'] });
  const r = await typeText('ok', { clipboard: 'wl-clipboard', input: 'ydotool', run: desk.run, sleep });
  assert.equal(r.ok, true);
  assert.equal(r.clipboard, 'other');
  assert.match(r.message, /held non-text content \(image\/png\) that cannot be put back; it is now empty\. Tell the developer/);
  assert.equal(desk.now().content, '', 'not left holding the typed text');
});

test('X11 meta targets alone mean an empty clipboard', async () => {
  const desk = fakeDesk({ tool: 'xclip', types: ['TARGETS', 'TIMESTAMP'] });
  assert.deepEqual(await saveClipboard('xclip', desk.run), { kind: 'empty' });
});

test('a failed paste still puts the clipboard back', async () => {
  const desk = fakeDesk({ tool: 'xsel', types: ['UTF8_STRING'], content: 'keep me', failPaste: true });
  const r = await typeText('x', { clipboard: 'xsel', input: 'xdotool', run: desk.run, sleep });
  assert.equal(r.ok, false);
  assert.equal(desk.now().content, 'keep me');
  assert.match(r.message, /^Not typed \(xdotool key failed\)\. The clipboard was restored\.$/);
});

test('without a clipboard tool nothing is typed, not even ASCII, and the package to install is named', async () => {
  const desk = fakeDesk({ tool: 'xclip' });
  for (const [text, input, session, pkg] of [
    ['Hello, world', 'ydotool', 'wayland', 'the wl-clipboard package'],
    ['Merhaba, çğışöü', 'xdotool', 'x11', 'the xclip package'],
    ['abc', 'xdotool', undefined, 'wl-clipboard \\(Wayland\\) or xclip \\(X11\\)'],
  ] as const) {
    const r = await typeText(text, { clipboard: null, input, session, run: desk.run, sleep });
    assert.equal(r.ok, false, text);
    assert.equal(r.via, 'none');
    assert.match(r.message, /^Not typed: no clipboard tool is installed/);
    assert.match(r.message, /Do not type it any other way/);
    assert.match(r.message, new RegExp(`tell the developer to install ${pkg}; \`cmc doctor\` prints the install command`));
  }
  assert.equal(desk.calls.length, 0, 'nothing was run');
});

// ---------- input guard ----------

const BLOCKED = [
  'ydotool key 29:1 30:1 30:0 29:0', // Ctrl+A
  'ydotool key 97:1 45:1 45:0 97:0', // right Ctrl+X
  'ydotool key -d 50 29:1 30:1 30:0 29:0',
  'ydotool key ctrl+a', // 0.x names
  'xdotool key ctrl+a',
  'xdotool key --clearmodifiers ctrl+x',
  'xdotool key Control_L+A',
  'xdotool keydown ctrl key a keyup ctrl',
  'sleep 1 && xdotool key ctrl+a',
];

test('the Linux guard blocks select-all and cut through ydotool and xdotool', () => {
  for (const c of BLOCKED) assert.equal(cu.blockedInput(c), cu.DENY_SHORTCUT, c);
});

test('the Linux guard allows undo, paste and ordinary keys', () => {
  for (const c of [
    'ydotool key 29:1 44:1 44:0 29:0', // Ctrl+Z
    'ydotool key 29:1 47:1 47:0 29:0', // Ctrl+V
    'ydotool key 30:1 30:0', // a alone
    'ydotool key 28:1 28:0',
    'xdotool key ctrl+z',
    'xdotool key ctrl+v',
    'xdotool key --clearmodifiers ctrl+shift+v',
    'xdotool key Return',
    'xdotool mousemove 10 10 click 1',
    "/usr/bin/node /x/bin/cmc.mjs type-text -- 'Merhaba, çğışöü'",
  ])
    assert.equal(cu.blockedInput(c), undefined, c);
});

test('the Linux guard blocks a Ctrl left pressed, raw clipboard tools and any key-by-key typing', () => {
  assert.equal(cu.blockedInput('ydotool key 29:1'), cu.DENY_HELD_CTRL);
  assert.equal(cu.blockedInput('xdotool keydown ctrl'), cu.DENY_HELD_CTRL);
  for (const c of ["printf 'x' | wl-copy", 'wl-paste', 'xclip -selection clipboard -o', 'echo a | xsel -b'])
    assert.equal(cu.blockedInput(c), cu.DENY_CLIPBOARD, c);
  for (const c of [
    "ydotool type -- 'Merhaba, çğ'",
    "xdotool type -- 'ü'",
    "ydotool type -- 'abc'",
    'xdotool type abc',
    "xdotool type --delay 40 -- 'plain ascii'",
    "xdotool mousemove 10 10 click 1 type 'hi'",
    "sleep 1 && ydotool type 'x'",
  ])
    assert.equal(cu.blockedInput(c), cu.DENY_TYPE, c);
});

test('the brain guard denies the shortcut on Linux and writes the denial to the audit trail', async () => {
  const can = guard('computer', undefined, securityPatterns(linux));
  const opts = { signal: new AbortController().signal } as any;
  const deny: any = await can('Bash', { command: 'ydotool key 29:1 30:1 30:0 29:0' }, opts);
  assert.equal(deny.behavior, 'deny');
  assert.equal(deny.message, cu.DENY_SHORTCUT);
  const allow: any = await can('Bash', { command: 'ydotool key 29:1 44:1 44:0 29:0' }, opts);
  assert.equal(allow.behavior, 'allow');
  const lines = readdirSync(join(home, 'audit')).flatMap((f) => readFileSync(join(home, 'audit', f), 'utf8').trim().split('\n')).map((l) => JSON.parse(l));
  assert.ok(lines.some((l) => l.kind === 'computer.deny' && l.reason === 'input policy' && l.command === 'ydotool key 29:1 30:1 30:0 29:0'));
});

test('macOS has no input guard: the same commands pass the macOS guard as before', async () => {
  assert.equal(darwin.security.inputGuard, undefined);
  const can = guard('computer', undefined, securityPatterns(darwin));
  const r: any = await can('Bash', { command: 'xdotool key ctrl+a' }, { signal: new AbortController().signal } as any);
  assert.equal(r.behavior, 'allow');
});

// ---------- prompt ----------

test('the Linux prompt has the focus, select-all/cut and undo rules when the agent can type', () => {
  const env = { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', XDG_CURRENT_DESKTOP: 'KDE' };
  const d = cu.selectComputerDriver(env, () => true);
  const p = computerSystemPrompt({ subject: 'computer', toolsBlock: cu.linuxToolsBlock(d, { shotDir: '/tmp/s', browser: true, typeCmd: 'cmc type-text' }), extraRules: cu.linuxExtraRules(d) }, 'en-US');
  for (const r of cu.LINUX_INPUT_RULES) assert.ok(p.includes(r), r);
  assert.match(p, /check that the right field has the keyboard focus/);
  assert.match(p, /click into that field first/);
  assert.match(p, /select-all \(Ctrl\+A\) and cut \(Ctrl\+X\) are blocked/);
  assert.match(p, /use only undo \(Ctrl\+Z\)/);
  assert.match(p, /puts the developer's clipboard back/);
  // Look-only (no input tool): no typing rules.
  const look = cu.selectComputerDriver(env, (b) => b !== 'ydotool');
  assert.deepEqual(cu.linuxExtraRules(look), cu.LINUX_EXTRA_RULES);
});
