import { execFileSync } from 'node:child_process';

/** Secrets live in the macOS login Keychain, never in config files. */
const SERVICE = 'dev.callmeclaude';

export type SecretName = 'gemini-api-key' | 'apns-p8';

export function getSecret(name: SecretName): string | undefined {
  const env = name === 'gemini-api-key' ? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY : undefined;
  if (env) return env;
  try {
    const out = execFileSync('security', ['find-generic-password', '-s', SERVICE, '-a', name, '-w'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (!out) return undefined;
    // multi-line secrets (p8) are stored base64 encoded
    return out.startsWith('b64:') ? Buffer.from(out.slice(4), 'base64').toString('utf8') : out;
  } catch {
    return undefined;
  }
}

export function setSecret(name: SecretName, value: string) {
  const v = value.includes('\n') ? 'b64:' + Buffer.from(value).toString('base64') : value;
  execFileSync('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', name, '-w', v], { stdio: 'ignore' });
}

export function deleteSecret(name: SecretName) {
  try {
    execFileSync('security', ['delete-generic-password', '-s', SERVICE, '-a', name], { stdio: 'ignore' });
  } catch {}
}
