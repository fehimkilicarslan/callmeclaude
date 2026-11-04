/**
 * Linux computer use: typing text through the clipboard.
 *
 * ydotool and xdotool send key codes for a US keyboard layout, so on any other layout typed text comes out wrong
 * (on Turkish Q "Merhaba," became "Merhabaö"). Pasting is layout-independent: the text goes onto the clipboard,
 * Ctrl+V is pressed, and the clipboard is put back the way it was. The logic is pure apart from the injected
 * `run`/`sleep`, so the whole flow is testable without a display.
 */
import { spawn } from 'node:child_process';
import type { InputTool, SessionKind } from './computerUse.ts';

export type ClipboardTool = 'wl-clipboard' | 'xclip' | 'xsel';

/** The clipboard tool for this session (wl-copy + wl-paste on Wayland, xclip or else xsel on X11), or null. */
export function selectClipboard(session: SessionKind, has: (bin: string) => boolean): ClipboardTool | null {
  if (session === 'wayland') return has('wl-copy') && has('wl-paste') ? 'wl-clipboard' : null;
  if (session === 'x11') return has('xclip') ? 'xclip' : has('xsel') ? 'xsel' : null;
  return null;
}

/** The package that provides a clipboard tool (doctor hint). */
export const clipboardPackage = (session: SessionKind) => (session === 'wayland' ? 'wl-clipboard' : 'xclip');

/** Text targets, best first. */
const TEXT_TYPES = ['text/plain;charset=utf-8', 'UTF8_STRING', 'text/plain', 'STRING', 'TEXT', 'COMPOUND_TEXT'];
/** X11 meta targets every owner lists; they say nothing about the content. */
const META_TYPES = new Set(['TARGETS', 'TIMESTAMP', 'MULTIPLE', 'SAVE_TARGETS', 'DELETE', 'INCR']);

export type ClipboardSnapshot = { kind: 'empty' } | { kind: 'text'; text: string } | { kind: 'other'; types: string[] };

export interface RunResult {
  status: number;
  stdout: string;
}
/** Run a command; `input` goes to stdin. `detach`: the command forks a selection owner (wl-copy, xclip -i, xsel -i). */
export type Runner = (cmd: string, args: string[], o?: { input?: string; detach?: boolean }) => Promise<RunResult>;

const ASCII = /^[\x20-\x7e\t\n]*$/;
export const isPlainAscii = (s: string) => ASCII.test(s);

/** Read what is on the clipboard now, without changing it. */
export async function saveClipboard(tool: ClipboardTool, run: Runner): Promise<ClipboardSnapshot> {
  if (tool === 'xsel') {
    // xsel cannot list targets: only text can be seen. Non-text content looks empty (said in the docs).
    const r = await run('xsel', ['--clipboard', '--output']);
    return r.status === 0 && r.stdout !== '' ? { kind: 'text', text: r.stdout } : { kind: 'empty' };
  }
  const list = tool === 'wl-clipboard' ? await run('wl-paste', ['--list-types']) : await run('xclip', ['-selection', 'clipboard', '-o', '-t', 'TARGETS']);
  const types = list.status === 0 ? list.stdout.split('\n').map((t) => t.trim()).filter((t) => t && !META_TYPES.has(t)) : [];
  if (!types.length) return { kind: 'empty' };
  const textType = TEXT_TYPES.find((t) => types.includes(t)) ?? types.find((t) => t.startsWith('text/plain'));
  if (!textType) return { kind: 'other', types };
  const r =
    tool === 'wl-clipboard'
      ? await run('wl-paste', ['--no-newline', '--type', textType])
      : await run('xclip', ['-selection', 'clipboard', '-o', '-t', textType]);
  return r.status === 0 ? { kind: 'text', text: r.stdout } : { kind: 'other', types };
}

async function writeClipboard(tool: ClipboardTool, text: string, run: Runner) {
  const [cmd, args] =
    tool === 'wl-clipboard'
      ? ['wl-copy', ['--type', 'text/plain;charset=utf-8']]
      : tool === 'xclip'
        ? ['xclip', ['-selection', 'clipboard', '-i']]
        : ['xsel', ['--clipboard', '--input']];
  const r = await run(cmd, args as string[], { input: text, detach: true });
  if (r.status !== 0) throw new Error(`${cmd} failed`);
}

async function clearClipboard(tool: ClipboardTool, run: Runner) {
  if (tool === 'wl-clipboard') await run('wl-copy', ['--clear']);
  else if (tool === 'xsel') await run('xsel', ['--clipboard', '--clear']);
  // xclip has no clear: leave an empty text instead of the typed text.
  else await writeClipboard(tool, '', run);
}

/** Paste shortcut: Ctrl+V, or Ctrl+Shift+V in a terminal window. ydotool takes Linux key codes (Ctrl 29, Shift 42, V 47). */
export function pasteKeys(input: InputTool, terminal = false): [string, string[]] {
  if (input === 'xdotool') return ['xdotool', ['key', '--clearmodifiers', terminal ? 'ctrl+shift+v' : 'ctrl+v']];
  return ['ydotool', ['key', ...(terminal ? ['29:1', '42:1', '47:1', '47:0', '42:0', '29:0'] : ['29:1', '47:1', '47:0', '29:0'])]];
}

export interface TypeTextResult {
  ok: boolean;
  /** One or two sentences for the agent (printed by `cmc type-text`). */
  message: string;
  /** For the audit trail: how the text went in and what happened to the clipboard (never the text itself). */
  via: 'clipboard' | 'keys' | 'none';
  clipboard?: ClipboardSnapshot['kind'];
}

/**
 * Put `text` into the focused field. With a clipboard tool: save the clipboard, copy the text, press the paste
 * shortcut, wait for the app to fetch it, put the clipboard back (text, or empty). Without one: type key by key,
 * plain ASCII only (anything else would depend on the keyboard layout).
 */
export async function typeText(
  text: string,
  o: { clipboard: ClipboardTool | null; input: InputTool | null; terminal?: boolean; run: Runner; sleep: (ms: number) => Promise<unknown>; settleMs?: number },
): Promise<TypeTextResult> {
  const n = [...text].length;
  if (!o.input) return { ok: false, via: 'none', message: 'No input tool (xdotool / ydotool) is available, so nothing can be typed on this computer.' };
  if (!o.clipboard) {
    if (!isPlainAscii(text)) {
      return {
        ok: false,
        via: 'none',
        message:
          'Not typed: no clipboard tool is installed (wl-clipboard on Wayland, xclip on X11), and without one only plain ASCII text can be typed. This text has other characters: do not type it another way; tell the developer.',
      };
    }
    const r = await o.run(o.input, o.input === 'xdotool' ? ['type', '--delay', '40', '--', text] : ['type', '--', text]);
    if (r.status !== 0) return { ok: false, via: 'keys', message: `${o.input} type failed.` };
    return {
      ok: true,
      via: 'keys',
      message: `Typed ${n} characters key by key (no clipboard tool). Keys follow a US layout: check the result in a screenshot.`,
    };
  }

  const saved = await saveClipboard(o.clipboard, o.run);
  let pasted = false;
  let failure = '';
  try {
    await writeClipboard(o.clipboard, text, o.run);
    await o.sleep(100);
    const [cmd, args] = pasteKeys(o.input, o.terminal);
    const r = await o.run(cmd, args);
    if (r.status !== 0) throw new Error(`${cmd} key failed`);
    pasted = true;
    // The app fetches the clipboard asynchronously after the key press: wait before putting the old content back.
    await o.sleep(o.settleMs ?? 500);
  } catch (e) {
    failure = (e as Error).message;
  } finally {
    try {
      if (saved.kind === 'text') await writeClipboard(o.clipboard, saved.text, o.run);
      else await clearClipboard(o.clipboard, o.run);
    } catch {}
  }
  const head = pasted ? `Pasted ${n} characters.` : `Not typed (${failure}).`;
  const tail =
    saved.kind === 'text'
      ? ' The clipboard was restored.'
      : saved.kind === 'empty'
        ? ' The clipboard was empty before and is empty again.'
        : ` The clipboard held non-text content (${saved.types.slice(0, 3).join(', ')}) that cannot be put back; it is now empty. Tell the developer in your final reply that their clipboard was cleared.`;
  return { ok: pasted, via: 'clipboard', clipboard: saved.kind, message: head + tail };
}

/** The real runner: 5 s timeout; forking selection owners are waited for by exit only (they keep their pipes open). */
export const spawnRunner: Runner = (cmd, args, o = {}) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['pipe', o.detach ? 'ignore' : 'pipe', 'ignore'] });
    let out = '';
    const t = setTimeout(() => p.kill(), 5000);
    p.stdout?.setEncoding('utf8').on('data', (d) => (out += d));
    p.on('error', () => {
      clearTimeout(t);
      resolve({ status: 127, stdout: '' });
    });
    // 'close' waits for stdout to drain; a forking owner keeps no pipe of ours open, so 'exit' is enough there.
    p.on(o.detach ? 'exit' : 'close', (code: number | null) => {
      clearTimeout(t);
      resolve({ status: code ?? 1, stdout: out });
    });
    p.stdin?.on('error', () => {});
    p.stdin?.end(o.input ?? '');
  });
