import { execFileSync, spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { LOG_DIR } from '../config.ts';
import { execFileP } from '../util.ts';
import { binPath, SERVICE_LABEL } from './common.ts';
import { SecretStoreError, type Platform } from './types.ts';
import {
  envSummary,
  installCommand,
  LINUX_EXTRA_RULES,
  linuxToolsBlock,
  packageManager,
  selectComputerDriver,
  UINPUT_RISK,
  uinputSteps,
  type ComputerDriver,
} from './computerUse.ts';

const UNIT_NAME = `${SERVICE_LABEL}.service`;
const UNIT_PATH = join(homedir(), '.config', 'systemd', 'user', UNIT_NAME);

/** Is `bin` an executable somewhere on PATH? */
export function onPath(bin: string, path = process.env.PATH ?? '') {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, bin), constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}

/** Same idea as the launchd PATH: system bins, the user's ~/.local/bin, and the directory of the running node. */
export function linuxServicePath(home: string, node: string) {
  const dirs = ['/usr/local/bin', '/usr/bin', '/bin', join(home, '.local/bin'), dirname(node)];
  return [...new Set(dirs)].join(':');
}

/** Escape a value for a systemd unit file: specifiers (%) always; quotes/backslashes inside "…" words. */
const sdEscape = (s: string) => s.replace(/%/g, '%%');
const sdQuote = (s: string) => `"${sdEscape(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** systemd --user unit text (pure, for tests). */
export function linuxUnit(o: { node: string; bin: string; path: string; home: string; logDir: string }) {
  return `[Unit]
Description=CallMeClaude hub (watches Claude Code sessions, calls your phone)

[Service]
Type=simple
ExecStart=${sdQuote(o.node)} ${sdQuote(o.bin)} serve
Restart=always
RestartSec=10
Environment=${sdQuote(`PATH=${o.path}`)}
Environment=${sdQuote(`HOME=${o.home}`)}
Environment=NODE_NO_WARNINGS=1
StandardOutput=append:${sdEscape(join(o.logDir, 'systemd.out.log'))}
StandardError=append:${sdEscape(join(o.logDir, 'systemd.err.log'))}

[Install]
WantedBy=default.target
`;
}

const SECRET_HELP = `Install secret-tool (Debian/Ubuntu: sudo apt install libsecret-tools · Fedora: sudo dnf install libsecret · Arch: sudo pacman -S libsecret) and make sure a Secret Service provider (GNOME Keyring or KeePassXC) is running and unlocked in this session, then run the setup command again.
   Alternative: put GEMINI_API_KEY into the service environment (systemctl --user edit ${UNIT_NAME}).
   Nothing was written to disk: CallMeClaude never stores secrets in plain-text files.`;

/** The login shell: $SHELL if set, else /bin/sh (no zsh assumption on Linux). */
export const linuxShell = (env: NodeJS.ProcessEnv = process.env) => env.SHELL || '/bin/sh';

const systemctl = (...args: string[]) => execFileP('systemctl', ['--user', ...args]);

/** Parse `key=value` lines (systemd-analyze cat-config output); later lines win, comments ignored. */
export function parseConf(text: string) {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Za-z]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** The computer-use driver for this process's environment and PATH. */
export const linuxComputerDriver = (env: NodeJS.ProcessEnv = process.env) => selectComputerDriver(env, (b) => onPath(b, env.PATH));

/** Browser config dirs where Claude Code installs its Claude in Chrome native messaging host. */
const BROWSER_DIRS = ['google-chrome', 'google-chrome-beta', 'chromium', 'microsoft-edge', 'BraveSoftware/Brave-Browser', 'vivaldi'];
const CHROME_HOST = 'com.anthropic.claude_code_browser_extension.json';

/** Browsers that have the Claude in Chrome native host installed (set up by `claude --chrome` / `/chrome`). */
export function chromeHosts(home = homedir()) {
  return BROWSER_DIRS.filter((d) => existsSync(join(home, '.config', d, 'NativeMessagingHosts', CHROME_HOST)));
}

function osRelease() {
  try {
    return readFileSync('/etc/os-release', 'utf8');
  } catch {
    return '';
  }
}

/** ydotoold's socket: $YDOTOOL_SOCKET, else the 1.x default in $XDG_RUNTIME_DIR, else the old /tmp one. */
function ydotoolSocket(env = process.env) {
  const c = [env.YDOTOOL_SOCKET, env.XDG_RUNTIME_DIR && join(env.XDG_RUNTIME_DIR, '.ydotool_socket'), '/tmp/.ydotool_socket'].filter(Boolean) as string[];
  return c.find((p) => existsSync(p));
}

const canWrite = (p: string) => {
  try {
    accessSync(p, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const ind = (lines: string[]) => lines.map((l) => `\n      ${l}`).join('');

function driverReport(d: ComputerDriver) {
  if (d.env.session === 'none') return `!${d.notes.join(' ')}`;
  const parts = [`${d.id}: screenshot ${d.screenshot ?? '—'}, input ${d.input ?? '—'}`];
  if (!d.desktop) return `!${parts[0]}. ${d.notes.join(' ')}`;
  if (!d.input) return `!${parts[0]}. Look-only: no mouse/keyboard tool${d.env.session === 'wayland' ? ' (ydotool, see below)' : ''}.`;
  return parts[0];
}

/** Parse `systemctl --user show-environment` output (NAME=value lines). */
export function parseEnvBlock(text: string) {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const SLEEP_TARGETS = ['sleep.target', 'suspend.target', 'hibernate.target', 'hybrid-sleep.target'];

export const linux: Platform = {
  id: 'linux',

  secrets: {
    displayName: 'keyring (libsecret)',
    get(service, account) {
      try {
        const out = execFileSync('secret-tool', ['lookup', 'service', service, 'account', account], {
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 15_000,
        })
          .toString()
          .trim();
        return out || undefined;
      } catch {
        return undefined;
      }
    },
    set(service, account, value) {
      if (!onPath('secret-tool')) throw new SecretStoreError(`secret-tool not found, could not store "${account}".\n   ${SECRET_HELP}`);
      try {
        execFileSync('secret-tool', ['store', `--label=CallMeClaude ${account}`, 'service', service, 'account', account], {
          input: value,
          stdio: ['pipe', 'ignore', 'pipe'],
          timeout: 60_000,
        });
      } catch (e) {
        const why = String((e as any).stderr ?? '').trim() || (e as Error).message.split('\n')[0];
        throw new SecretStoreError(`secret-tool could not store "${account}" (${why}).\n   ${SECRET_HELP}`);
      }
    },
    delete(service, account) {
      try {
        execFileSync('secret-tool', ['clear', 'service', service, 'account', account], { stdio: 'ignore', timeout: 15_000 });
      } catch {}
    },
  },

  service: {
    displayName: 'systemd --user',
    label: SERVICE_LABEL,
    definitionPath: UNIT_PATH,
    async install() {
      const node = process.execPath;
      const unit = linuxUnit({ node, bin: binPath(), path: linuxServicePath(homedir(), node), home: homedir(), logDir: LOG_DIR });
      const wasActive = await systemctl('is-active', '--quiet', UNIT_NAME).then(() => true, () => false);
      mkdirSync(dirname(UNIT_PATH), { recursive: true });
      writeFileSync(UNIT_PATH, unit);
      await systemctl('daemon-reload');
      await systemctl('enable', '--now', UNIT_NAME);
      // launchd's bootout+bootstrap always reloads; do the same when the hub was already running with an old unit/config.
      if (wasActive) await systemctl('restart', UNIT_NAME);
    },
    async uninstall() {
      await systemctl('disable', '--now', UNIT_NAME).catch(() => {});
      if (existsSync(UNIT_PATH)) unlinkSync(UNIT_PATH);
      await systemctl('daemon-reload').catch(() => {});
    },
    async restart() {
      await systemctl('restart', UNIT_NAME);
    },
  },

  // Checks and advice only: nothing here changes the system or runs sudo.
  doctorChecks: () => [
    {
      name: 'Secret store (secret-tool)',
      fn: async () => (onPath('secret-tool') ? true : '!not installed → libsecret-tools / libsecret package'),
    },
    {
      name: 'Hub runs without a login (linger)',
      fn: async () => {
        const user = process.env.USER || userInfo().username;
        const { stdout } = await execFileP('loginctl', ['show-user', user, '-p', 'Linger']);
        return /Linger=yes/.test(stdout) ? true : `!off → sudo loginctl enable-linger ${user}`;
      },
    },
    {
      name: 'System sleep disabled (sleep targets masked)',
      fn: async () => {
        // is-enabled exits non-zero for masked units; the per-unit lines are still on stdout.
        const { stdout } = await execFileP('systemctl', ['is-enabled', ...SLEEP_TARGETS]).catch((e) => ({ stdout: String(e.stdout ?? '') }));
        const states = stdout.trim().split('\n');
        const open = SLEEP_TARGETS.filter((_, i) => !/^masked/.test(states[i] ?? ''));
        return open.length ? `!not masked: ${open.join(' ')} → sudo systemctl mask ${SLEEP_TARGETS.join(' ')}` : true;
      },
    },
    {
      name: 'No sleep with lid closed',
      fn: async () => {
        let isLaptop = false;
        try {
          isLaptop = readdirSync('/sys/class/power_supply').some((n) => n.startsWith('BAT'));
        } catch {}
        if (!isLaptop) return true;
        const { stdout } = await execFileP('systemd-analyze', ['cat-config', 'systemd/logind.conf']);
        const conf = parseConf(stdout);
        // logind defaults: HandleLidSwitch=suspend; HandleLidSwitchExternalPower falls back to HandleLidSwitch.
        const battery = conf.HandleLidSwitch ?? 'suspend';
        const ac = conf.HandleLidSwitchExternalPower ?? battery;
        return battery === 'ignore' && ac === 'ignore'
          ? true
          : `!HandleLidSwitch=${battery}, HandleLidSwitchExternalPower=${ac} → keep the lid open, or set both to ignore in /etc/systemd/logind.conf.d/`;
      },
    },
    ...computerUseChecks(),
  ],

  async computerUse({ useChrome }) {
    const d = linuxComputerDriver();
    const browser = useChrome && chromeHosts().length > 0;
    if (!d.desktop && !browser) {
      return {
        driver: d.id,
        subject: 'computer',
        toolsBlock: '',
        extraRules: [],
        mcpServers: {},
        usable: false,
        unsupported: `Operating this computer is not supported in this environment (${envSummary(d.env)}): ${d.notes.join(' ')} The Claude in Chrome browser tools are not set up either. Run cmc doctor on the computer for the steps.`,
        cleanup() {},
      };
    }
    // Private per-task directory for screenshots (0700); removed when the task ends, whatever the agent did.
    const shotDir = d.desktop ? mkdtempSync(join(tmpdir(), 'cmc-screen-')) : '';
    return {
      driver: d.id,
      subject: 'computer',
      toolsBlock: linuxToolsBlock(d, { shotDir, browser }),
      extraRules: LINUX_EXTRA_RULES,
      mcpServers: {},
      usable: true,
      cleanup() {
        if (shotDir) rmSync(shotDir, { recursive: true, force: true });
      },
    };
  },
  words: { owners: "the developer's computer", the: 'this computer', this: 'this computer' },

  shellExec: (command, opts) => execFileP(linuxShell(), ['-lc', command], { ...opts, encoding: 'utf8' }),
  servicePath: () => linuxServicePath(homedir(), process.execPath),
  tailscaleBins: ['tailscale'],
  isLanInterface: (name) => !name.startsWith('tailscale'),
  openFile(path) {
    // xdg-open may stay in the foreground with some viewers: detach. Errors (headless box) are ignored.
    try {
      const p = spawn('xdg-open', [path], { detached: true, stdio: 'ignore' });
      p.on('error', () => {});
      p.unref();
    } catch {}
  },

  security: {
    protectedPaths: [/\.local\/share\/keyrings/, /\.local\/share\/kwalletd/],
    destructive: [
      'rm\\s+-rf?\\s+[~\\/]',
      'mkfs',
      'wipefs',
      'blkdiscard',
      'dd\\s+if=',
      ':\\(\\)\\s*\\{',
      'shutdown',
      'halt\\b',
      'poweroff\\b',
      'systemctl\\s+.*\\b(poweroff|reboot|halt|kexec)\\b',
      'secret-tool\\s+(lookup|clear|search)',
      'systemctl\\s+.*\\b(stop|disable|mask|kill)\\b.*dev\\.callmeclaude',
      'sudo\\s',
    ],
  },

  async diagnostics() {
    return {
      node: process.execPath,
      platform: `linux ${process.arch}`,
      shell: linuxShell(),
      display: process.env.WAYLAND_DISPLAY ? `wayland (${process.env.WAYLAND_DISPLAY})` : process.env.DISPLAY ? `x11 (${process.env.DISPLAY})` : 'none',
      secretTool: onPath('secret-tool') ? 'found' : 'missing',
      computerUse: (() => {
        const d = linuxComputerDriver();
        return `${d.id} (${envSummary(d.env)}): screenshot ${d.screenshot ?? 'none'}, input ${d.input ?? 'none'}`;
      })(),
      chrome: chromeHosts().join(', ') || 'native host not installed',
    };
  },
};

/** Doctor checks for computer use: detect, report and advise only. Nothing here changes the system. */
function computerUseChecks() {
  const d = linuxComputerDriver();
  const pm = packageManager(osRelease());
  const user = process.env.USER || userInfo().username;
  const checks: { name: string; fn: () => Promise<boolean | string> }[] = [
    { name: 'Computer use: desktop session', fn: async () => (d.env.session === 'none' ? `!${d.notes[0]}` : envSummary(d.env)) },
    { name: 'Computer use: driver', fn: async () => driverReport(d) },
  ];
  const needed = d.missing.filter((m) => m.tool !== 'ydotool');
  if (needed.length) {
    checks.push({
      name: 'Computer use: missing tools',
      fn: async () => `!${needed.map((m) => `${m.tool} (${m.purpose})`).join(', ')} → ${installCommand(pm, needed.map((m) => m.tool))}`,
    });
  }
  if (d.env.session === 'wayland') {
    checks.push({
      name: 'Computer use: ydotool (optional, Wayland mouse/keyboard)',
      fn: async () => {
        let userUnit = false;
        try {
          await execFileP('systemctl', ['--user', 'cat', 'ydotool.service']);
          userUnit = true;
        } catch {}
        const installed = d.input === 'ydotool';
        const uinput = canWrite('/dev/uinput');
        const sock = ydotoolSocket();
        if (installed && uinput && sock) return `ready (ydotoold socket ${sock}). ${UINPUT_RISK.replace('once this is allowed', 'because it is allowed')}`;
        const state = [`ydotool ${installed ? 'installed' : 'not installed'}`, `/dev/uinput ${uinput ? 'already writable' : 'not writable for ' + user}`, `ydotoold ${sock ? 'running' : 'not running'}`];
        const steps = uinputSteps(pm, user, { installed, uinput, daemon: !!sock, userUnit });
        return `!${state.join(', ')}. One-time setup, run it yourself only if you want this:${ind(steps.map((x, i) => `${i + 1}. ${x}`))}${ind([UINPUT_RISK])}`;
      },
    });
  }
  checks.push({
    name: 'Computer use: hub service sees the desktop',
    fn: async () => {
      const { stdout } = await execFileP('systemctl', ['--user', 'show-environment']);
      const env = parseEnvBlock(stdout);
      const vars = ['WAYLAND_DISPLAY', 'DISPLAY', 'XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP'];
      const svc = selectComputerDriver(Object.fromEntries(vars.map((v) => [v, env[v]])), (b) => onPath(b));
      if (svc.id === d.id) return `${svc.id}`;
      return `!service environment gives "${svc.id}" (this shell: "${d.id}") → systemctl --user import-environment ${vars.join(' ')}, then cmc restart`;
    },
  });
  checks.push({
    name: 'Computer use: browser (Claude in Chrome)',
    fn: async () => {
      const found = chromeHosts();
      return found.length ? `native host installed for ${found.join(', ')}` : '!not set up → install the Claude in Chrome extension and run `claude --chrome` once';
    },
  });
  return checks;
}
