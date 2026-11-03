import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import qrcode from 'qrcode-terminal';
import QR from 'qrcode';
import type { PairingInfo } from '@callmeclaude/protocol';
import { PROTOCOL_VERSION } from '@callmeclaude/protocol';
import { CONFIG_PATH, LOG_DIR, loadConfig, saveConfig, type Mode } from './config.ts';
import { getSecret, setSecret } from './secrets.ts';
import { hooksInstalled, installHooks, installService, restartService, uninstallHooks, uninstallService, SERVICE } from './install.ts';
import { platform, SecretStoreError } from './platform/index.ts';
import { execFileP } from './util.ts';
import { apnsConfigured } from './apns.ts';

const [cmd = 'help', ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);

function parseFlags(a: string[]) {
  const f: Record<string, string | true> = {};
  const pos: string[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      const v = a[i + 1];
      if (v !== undefined && !v.startsWith('--')) {
        f[k] = v;
        i++;
      } else f[k] = true;
    } else pos.push(a[i]);
  }
  (f as any)._ = pos;
  return f as Record<string, string | true> & { _: string[] };
}

const ok = (b: boolean) => (b ? '✅' : '❌');

async function api(path: string, body?: object) {
  const cfg = loadConfig();
  const r = await fetch(`http://127.0.0.1:${cfg.hookPort}/control/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${cfg.hookToken}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json() as Promise<any>;
}

/** Restart the background service (launchd / systemd --user) and wait until the hub answers. */
async function restartAndWait() {
  await restartService();
  const cfg = loadConfig();
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${cfg.hookPort}/health`)).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** Store a secret; if the OS secret store is unavailable (Linux without libsecret), explain instead of crashing. */
function storeSecret(fn: () => void) {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof SecretStoreError)) throw e;
    console.log(`❌ ${e.message}`);
    process.exitCode = 1;
  }
}

async function tailscaleInfo(): Promise<{ ip?: string; dns?: string }> {
  for (const bin of platform.tailscaleBins) {
    try {
      const { stdout } = await execFileP(bin, ['status', '--json'], { timeout: 4000 });
      const j = JSON.parse(stdout);
      return { ip: j.Self?.TailscaleIPs?.find((x: string) => x.includes('.')), dns: String(j.Self?.DNSName ?? '').replace(/\.$/, '') || undefined };
    } catch {}
  }
  return {};
}

function lanIps() {
  const out: string[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal && platform.isLanInterface(name) && !a.address.startsWith('100.')) out.push(a.address);
  }
  return out;
}

async function main() {
  switch (cmd) {
    case 'serve': {
      const { Hub } = await import('./hub.ts');
      new Hub().start();
      return;
    }

    case 'setup': {
      const cfg = loadConfig();
      if (typeof flags['gemini-key'] === 'string') storeSecret(() => setSecret('gemini-api-key', flags['gemini-key'] as string));
      if (typeof flags['apns-key-file'] === 'string') storeSecret(() => setSecret('apns-p8', readFileSync(flags['apns-key-file'] as string, 'utf8')));
      if (typeof flags['apns-key-id'] === 'string') cfg.apns.keyId = flags['apns-key-id'];
      if (typeof flags['team-id'] === 'string') cfg.apns.teamId = flags['team-id'];
      if (typeof flags['bundle-id'] === 'string') cfg.apns.bundleId = flags['bundle-id'];
      if (typeof flags['apns-env'] === 'string') cfg.apns.environment = flags['apns-env'] as any;
      if (typeof flags.voice === 'string') cfg.voice.voiceName = flags.voice;
      if (typeof flags.model === 'string') cfg.voice.model = flags.model;
      if (typeof flags.language === 'string') cfg.language = flags.language;
      saveConfig(cfg);
      if (!flags['no-hooks']) {
        installHooks(cfg);
        console.log('✅ Claude Code hooks merged into ~/.claude/settings.json (backup saved).');
      }
      if (!flags['no-service']) {
        await installService();
        console.log(`✅ ${SERVICE.displayName} service installed: ${SERVICE.definitionPath}`);
      }
      if (!getSecret('gemini-api-key')) console.log('⚠️  No Gemini API key: cmc setup --gemini-key <KEY>  (https://aistudio.google.com/apikey)');
      if (!apnsConfigured(cfg)) console.log('⚠️  APNs not configured (the hub can only ring the phone while the app is open): cmc setup --apns-key-file AuthKey_XXX.p8 --apns-key-id XXX --team-id XXX --bundle-id XXX');
      console.log(`Voice language: ${cfg.language}  (change with --language, e.g. en-US, tr-TR, de-DE)`);
      console.log('Next: cmc pair  (scan the QR code with the app)');
      return;
    }

    case 'pair': {
      const cfg = loadConfig();
      if (flags.rotate) {
        cfg.appToken = randomBytes(24).toString('base64url');
        saveConfig(cfg);
        await restartAndWait().catch(() => {});
      }
      const ts = await tailscaleInfo();
      const urls = [
        // IP first: no DNS lookup needed when the phone wakes from a push on cellular.
        ...(ts.ip ? [`ws://${ts.ip}:${cfg.appPort}`] : []),
        ...(ts.dns ? [`ws://${ts.dns}:${cfg.appPort}`] : []),
        ...lanIps().map((ip) => `ws://${ip}:${cfg.appPort}`),
      ];
      const info: PairingInfo = { v: PROTOCOL_VERSION, name: hostname().replace(/\.local$/, ''), urls, token: cfg.appToken };
      const text = JSON.stringify(info);
      qrcode.generate(text, { small: true });
      const png = join(CONFIG_PATH, '..', 'pair.png');
      await QR.toFile(png, text, { width: 640, margin: 2 });
      if (!flags['no-open']) platform.openFile(png);
      console.log('\nIn the CallMeClaude app tap "Pair Mac" and scan this QR code. To enter it manually:\n');
      console.log(text);
      if (!ts.ip) console.log('\n⚠️  Tailscale is not connected: to reach this Mac on the road, log in to Tailscale on the Mac and the phone, then run `cmc pair` again.');
      return;
    }

    case 'status': {
      try {
        const r = await api('status');
        const s = r.snapshot;
        console.log(`Mode: ${s.mode}${s.paused ? ' (PAUSED)' : ''} · call: ${r.voiceActive ? 'active' : r.ringing ? 'ringing' : 'none'} · queued: ${r.queued} · language: ${s.language}`);
        for (const x of s.sessions) console.log(`  ${x.state.padEnd(18)} ${x.project.padEnd(28)} ${x.summary}`);
        if (s.pending.length) console.log('Pending decisions:');
        for (const p of s.pending) console.log(`  [${p.risk}] ${p.project}: ${p.summary}`);
      } catch {
        console.log('❌ Hub is not running. Try `cmc restart`, `cmc logs`, or `cmc setup`.');
        process.exitCode = 1;
      }
      return;
    }

    case 'call-me': {
      const r = await api('call-me', { text: typeof flags.text === 'string' ? flags.text : undefined });
      console.log(r.viaSocket || r.viaPush ? `📞 Calling (socket: ${r.viaSocket}, push: ${r.viaPush})` : '❌ Could not reach the phone (app not connected and APNs not configured).');
      return;
    }

    case 'do': {
      const task = flags._.join(' ');
      if (!task) return console.log('usage: cmc do "<what the hub should do on this Mac>"');
      console.log('⏳ The hub is working on it…');
      const r = await api('do', { task, project: typeof flags.project === 'string' ? flags.project : undefined });
      return console.log(r.result);
    }

    case 'mode': {
      const m = flags._[0] as Mode;
      if (!['desk', 'away', 'ride', 'sleep'].includes(m)) return console.log('usage: cmc mode desk|away|ride|sleep');
      await api('mode', { mode: m });
      return console.log(`Mode: ${m}`);
    }

    case 'panic':
      await api('panic', {});
      return console.log('🛑 All sessions interrupted; automation paused. Undo with: cmc resume');
    case 'resume':
      await api('resume', {});
      return console.log('▶️  Automation resumed.');

    case 'run': {
      // Start an interactive Claude Code session inside tmux so the hub can type into it.
      const dir = flags._[0] ?? process.cwd();
      const task = flags._.slice(1).join(' ');
      const name = 'cmc-' + dir.split('/').filter(Boolean).pop()!.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) + '-' + Date.now().toString(36).slice(-4);
      const args = ['new-session', '-s', name, '-c', dir, 'claude', ...(task ? [task] : [])];
      if (!process.stdout.isTTY) args.splice(1, 0, '-d');
      spawnSync('tmux', args, { stdio: 'inherit' });
      return;
    }

    case 'ignore': {
      // cmc ignore [path] | cmc ignore --remove path | cmc ignore --list
      const cfg = loadConfig();
      const target = flags._[0] ?? process.cwd();
      if (flags.list) return console.log(cfg.ignorePaths.join('\n') || '(none)');
      cfg.ignorePaths = cfg.ignorePaths.filter((p) => p !== target);
      if (!flags.remove) cfg.ignorePaths.push(target);
      saveConfig(cfg);
      await restartAndWait().catch(() => {});
      return console.log(`${flags.remove ? 'Back to normal (may hold sessions and call you)' : 'Watch-only (status is reported; never held, never calls)'}: ${target}`);
    }

    case 'doctor':
      return doctor();

    case 'logs': {
      const files = readdirSync(LOG_DIR).filter((f) => f.startsWith('hub-')).sort();
      const last = files.at(-1);
      if (!last) return console.log('no logs yet');
      spawnSync('tail', ['-n', String(flags.n ?? 80), ...(flags.f ? ['-f'] : []), join(LOG_DIR, last)], { stdio: 'inherit' });
      return;
    }

    case 'restart':
      return console.log((await restartAndWait()) ? 'Hub restarted.' : '❌ The hub did not start: cmc logs');

    case 'uninstall':
      uninstallHooks();
      await uninstallService();
      return console.log(`Hooks and service removed. Your data is still in ${CONFIG_PATH} (delete it manually if you like).`);

    default:
      console.log(`CallMeClaude — cmc <command>

  setup [--gemini-key K] [--language en-US] [--apns-key-file F --apns-key-id I --team-id T --bundle-id B]
                       Install hooks + service, store keys in the ${platform.secrets.displayName}
  pair [--rotate]      Show the QR code for pairing the phone
  status               Sessions and pending decisions
  call-me [--text ..]  Ring the phone now (test)
  mode desk|away|ride|sleep
                       When the hub may hold sessions and call you
  run [dir] [task]     Start Claude Code inside tmux (so the hub can type into it)
  ignore [dir] [--remove|--list]
                       Watch-only: report status, never hold or call
  do "<task>"          Let the hub do something on this Mac (browser/desktop)
  panic | resume       Interrupt everything / resume automation
  doctor               Check the installation
  logs [-f]            Hub logs
  restart | uninstall`);
  }
}

async function doctor() {
  const cfg = loadConfig();
  const check = async (name: string, fn: () => Promise<boolean | string>) => {
    try {
      const r = await fn();
      console.log(`${ok(r === true || (typeof r === 'string' && !r.startsWith('!')))} ${name}${typeof r === 'string' ? ': ' + r.replace(/^!/, '') : ''}`);
    } catch (e) {
      console.log(`❌ ${name}: ${(e as Error).message}`);
    }
  };
  await check('Claude Code installed', async () => (await execFileP('claude', ['--version'])).stdout.trim());
  await check('Claude Code login (your own plan)', async () => {
    const { stdout } = await execFileP('claude', ['-p', 'Reply with just OK.', '--model', 'haiku', '--max-turns', '1'], { timeout: 60_000, env: { ...process.env, CMC_INTERNAL: '1' } });
    return stdout.trim() ? 'working' : '!empty reply';
  });
  await check('Hooks installed', async () => hooksInstalled());
  await check('Hub running', async () => {
    const r = await fetch(`http://127.0.0.1:${cfg.hookPort}/health`);
    return r.ok;
  });
  await check('Gemini API key', async () => !!getSecret('gemini-api-key'));
  await check('APNs (hub can ring the phone)', async () => (apnsConfigured(cfg) ? `${cfg.apns.environment}` : '!not configured'));
  await check('Phone registered (VoIP token)', async () => {
    const p = join(CONFIG_PATH, '..', 'devices.json');
    if (!existsSync(p)) return '!not paired yet';
    const d = JSON.parse(readFileSync(p, 'utf8'));
    return Object.values(d).some((x: any) => x.voipToken) ? Object.keys(d).join(', ') : '!no token yet';
  });
  await check('Tailscale', async () => {
    const t = await tailscaleInfo();
    return t.ip ? `${t.dns ?? t.ip}` : '!not connected (no access on the road)';
  });
  await check('tmux', async () => (await execFileP('tmux', ['-V'])).stdout.trim());
  for (const c of platform.doctorChecks()) await check(c.name, c.fn);
  await check('Mode', async () => cfg.mode);
  await check('Voice language', async () => cfg.language);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
