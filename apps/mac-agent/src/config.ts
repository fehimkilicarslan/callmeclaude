import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const DATA_DIR = process.env.CMC_HOME ?? join(homedir(), '.callmeclaude');
export const CONFIG_PATH = join(DATA_DIR, 'config.json');
export const STATE_PATH = join(DATA_DIR, 'state.json');
export const AUDIT_DIR = join(DATA_DIR, 'audit');
export const LOG_DIR = join(DATA_DIR, 'logs');
export const BRAIN_DIR = join(DATA_DIR, 'brain');

export type Mode = 'desk' | 'away' | 'ride' | 'sleep';

export interface Config {
  hookPort: number;
  appPort: number;
  /** Bearer token used by Claude Code HTTP hooks (localhost). */
  hookToken: string;
  /** Token the phone app must present. Rotated by `cmc pair --rotate`. */
  appToken: string;
  mode: Mode;
  /** BCP-47 code of the language the voice agent speaks and summaries are written in (e.g. en-US, tr-TR). */
  language: string;
  voice: {
    provider: 'gemini-live';
    model: string;
    voiceName: string;
  };
  claude: {
    classifyModel: string;
    brainModel: string;
    computerModel: string;
    /** Use Claude-in-Chrome (`claude --chrome`) inside computer tasks. */
    useChrome: boolean;
  };
  apns: {
    teamId: string;
    keyId: string;
    bundleId: string;
    /** 'development' for Xcode-installed builds, 'production' for TestFlight/App Store. */
    environment: 'development' | 'production';
  };
  calls: {
    batchSeconds: { P1: number; P2: number };
    minGapSeconds: number;
    retryMissedAfterSeconds: number;
    maxRetries: number;
  };
  /** How long Stop / PermissionRequest hooks are held open waiting for the developer. */
  holdSeconds: number;
  projectRoots: string[];
  /** Watch-only folders: sessions are tracked and reported, but never held and never trigger calls. */
  ignorePaths: string[];
  /** Per-project auto-approve rules: tool name prefixes, e.g. "Bash(npm test", "Edit". */
  autoApprove: Record<string, string[]>;
}

function defaultRoots(): string[] {
  const h = homedir();
  return ['Desktop/Projeler', 'Projects', 'Projeler', 'code', 'dev', 'src', 'Developer']
    .map((p) => join(h, p))
    .filter((p) => existsSync(p));
}

export function defaultConfig(): Config {
  return {
    hookPort: 47800,
    appPort: 47801,
    hookToken: randomBytes(24).toString('hex'),
    appToken: randomBytes(24).toString('base64url'),
    mode: 'away',
    language: 'en-US',
    voice: { provider: 'gemini-live', model: 'gemini-3.8-live', voiceName: 'Puck' },
    claude: {
      classifyModel: 'haiku',
      brainModel: 'sonnet',
      computerModel: 'sonnet',
      useChrome: true,
    },
    apns: { teamId: '', keyId: '', bundleId: '', environment: 'development' },
    calls: { batchSeconds: { P1: 15, P2: 45 }, minGapSeconds: 90, retryMissedAfterSeconds: 180, maxRetries: 2 },
    holdSeconds: 1500,
    projectRoots: defaultRoots(),
    ignorePaths: [],
    autoApprove: {},
  };
}

export function ensureDirs() {
  for (const d of [DATA_DIR, AUDIT_DIR, LOG_DIR, BRAIN_DIR]) mkdirSync(d, { recursive: true, mode: 0o700 });
}

function deepMerge<T>(base: T, over: any): T {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return (over ?? base) as T;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const k of Object.keys(over)) {
    const b = (base as any)?.[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) ? deepMerge(b, over[k]) : over[k];
  }
  return out;
}

export function loadConfig(): Config {
  ensureDirs();
  if (!existsSync(CONFIG_PATH)) {
    const c = defaultConfig();
    saveConfig(c);
    return c;
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  return deepMerge(defaultConfig(), raw);
}

export function saveConfig(c: Config) {
  ensureDirs();
  writeAtomic(CONFIG_PATH, JSON.stringify(c, null, 2));
}

export function writeAtomic(path: string, data: string) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, path);
}
