import { platform } from './platform/index.ts';

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
