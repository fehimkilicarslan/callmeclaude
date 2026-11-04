import { platform } from './platform/index.ts';
import type { SecretState } from './platform/types.ts';

/** Secrets live in the OS secret store (macOS login Keychain / Linux libsecret keyring), never in config files. */
const SERVICE = 'dev.callmeclaude';

export type SecretName = 'gemini-api-key' | 'apns-p8';

export function getSecret(name: SecretName): string | undefined {
  const env = name === 'gemini-api-key' ? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY : undefined;
  if (env) return env;
  const out = platform.secrets.get(SERVICE, name);
  if (!out) return undefined;
  // multi-line secrets (p8) are stored base64 encoded
  return out.startsWith('b64:') ? Buffer.from(out.slice(4), 'base64').toString('utf8') : out;
}

export function setSecret(name: SecretName, value: string) {
  const v = value.includes('\n') ? 'b64:' + Buffer.from(value).toString('base64') : value;
  platform.secrets.set(SERVICE, name, v);
}

export function deleteSecret(name: SecretName) {
  platform.secrets.delete(SERVICE, name);
}

/** The error the phone shows when the voice key is missing (macOS: unchanged). */
export const GEMINI_KEY_MISSING = 'No Gemini API key. Run `cmc setup --gemini-key <KEY>`.';

/**
 * The phone's error text when the Gemini key cannot be read (pure). On Linux the key lives in the keyring, which
 * is locked (or not running) until the developer logs in to the desktop: say that instead of "no key".
 */
export function geminiKeyMissingText(os: NodeJS.Platform, state?: SecretState): string {
  if (os !== 'linux') return GEMINI_KEY_MISSING;
  switch (state) {
    case 'locked':
      return 'The voice key is in the keyring, which is locked: it unlocks when you log in to the computer. Log in once, then call again.';
    case 'unreachable':
      return 'The voice key could not be read: the keyring is not running yet. It starts and unlocks when you log in to the computer; log in once, then call again. If you never stored a key, run `cmc setup --gemini-key <KEY>` on the computer.';
    case 'unknown':
      return 'The voice key could not be read. If you stored it with `cmc setup --gemini-key`, it is in the keyring, which unlocks when you log in to the computer: log in once, then call again. Otherwise run `cmc setup --gemini-key <KEY>` on the computer.';
    default:
      return GEMINI_KEY_MISSING;
  }
}

/** Why the Gemini key is missing right now, as the phone's error text (asks the keyring again on Linux). */
export function geminiKeyProblem(): string {
  const state = platform.id === 'linux' ? platform.secrets.diagnose?.(SERVICE, 'gemini-api-key') : undefined;
  return geminiKeyMissingText(platform.id, state);
}
