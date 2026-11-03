import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from './config.ts';
import { LOG_DIR, writeAtomic } from './config.ts';
import { execFileP } from './util.ts';

export const CLAUDE_SETTINGS = join(homedir(), '.claude', 'settings.json');
export const PLIST_LABEL = 'dev.callmeclaude.hub';
export const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);

const EVENTS: Array<[string, 'short' | 'hold' | 'tool']> = [
  ['SessionStart', 'short'],
  ['SessionEnd', 'short'],
  ['UserPromptSubmit', 'short'],
  ['Notification', 'short'],
  ['PreToolUse', 'tool'],
  ['PostToolUse', 'tool'],
  ['StopFailure', 'short'],
  ['Stop', 'hold'],
  ['PermissionRequest', 'hold'],
];

const isOurs = (h: any) => typeof h?.url === 'string' && /127\.0\.0\.1:\d+\/hooks\//.test(h.url) && h?.headers?.['X-CMC'] === '1';

/** Merge our HTTP hooks into ~/.claude/settings.json (backup first, keep everything else). */
export function installHooks(cfg: Config) {
  mkdirSync(dirname(CLAUDE_SETTINGS), { recursive: true });
  let settings: any = {};
  if (existsSync(CLAUDE_SETTINGS)) {
    const raw = readFileSync(CLAUDE_SETTINGS, 'utf8');
    settings = raw.trim() ? JSON.parse(raw) : {};
    copyFileSync(CLAUDE_SETTINGS, `${CLAUDE_SETTINGS}.cmc-backup-${Date.now()}`);
  }
  removeOurHooks(settings);
  settings.hooks ??= {};
  for (const [event, kind] of EVENTS) {
    const timeout = kind === 'hold' ? cfg.holdSeconds + 60 : kind === 'tool' ? 3 : 5;
    const hook = {
      type: 'http',
      url: `http://127.0.0.1:${cfg.hookPort}/hooks/${event}`,
      timeout,
      headers: { Authorization: `Bearer ${cfg.hookToken}`, 'X-CMC': '1', 'X-CMC-Tmux-Pane': '$TMUX_PANE' },
      allowedEnvVars: ['TMUX_PANE'],
    };
    (settings.hooks[event] ??= []).push({ hooks: [hook] });
  }
  writeAtomic(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + '\n');
}

function removeOurHooks(settings: any) {
  for (const event of Object.keys(settings.hooks ?? {})) {
    const groups = (settings.hooks[event] as any[])
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h: any) => !isOurs(h)) }))
      .filter((g) => g.hooks.length);
    if (groups.length) settings.hooks[event] = groups;
    else delete settings.hooks[event];
  }
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
}

export function uninstallHooks() {
  if (!existsSync(CLAUDE_SETTINGS)) return;
  const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf8'));
  copyFileSync(CLAUDE_SETTINGS, `${CLAUDE_SETTINGS}.cmc-backup-${Date.now()}`);
  removeOurHooks(settings);
  writeAtomic(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + '\n');
}

export function hooksInstalled(): boolean {
  if (!existsSync(CLAUDE_SETTINGS)) return false;
  const s = JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf8'));
  return Object.values(s.hooks ?? {}).some((gs: any) => gs.some((g: any) => (g.hooks ?? []).some(isOurs)));
}

const binPath = () => resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cmc.mjs');

/** launchd agent: start at login, restart on crash. */
export async function installLaunchd() {
  const node = process.execPath;
  const path = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin', join(homedir(), '.local/bin'), dirname(node)].join(':');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${binPath()}</string><string>serve</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${path}</string>
    <key>HOME</key><string>${homedir()}</string>
    <key>NODE_NO_WARNINGS</key><string>1</string>
  </dict>
  <key>StandardOutPath</key><string>${join(LOG_DIR, 'launchd.out.log')}</string>
  <key>StandardErrorPath</key><string>${join(LOG_DIR, 'launchd.err.log')}</string>
</dict></plist>
`;
  mkdirSync(dirname(PLIST_PATH), { recursive: true });
  await execFileP('launchctl', ['bootout', `gui/${process.getuid!()}/${PLIST_LABEL}`]).catch(() => {});
  writeFileSync(PLIST_PATH, plist);
  await execFileP('launchctl', ['bootstrap', `gui/${process.getuid!()}`, PLIST_PATH]);
}

export async function uninstallLaunchd() {
  await execFileP('launchctl', ['bootout', `gui/${process.getuid!()}/${PLIST_LABEL}`]).catch(() => {});
  if (existsSync(PLIST_PATH)) unlinkSync(PLIST_PATH);
}

export async function restartLaunchd() {
  await execFileP('launchctl', ['kickstart', '-k', `gui/${process.getuid!()}/${PLIST_LABEL}`]);
}
