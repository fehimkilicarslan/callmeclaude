import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desktopSessionEnv, needsSessionEnv, selectComputerDriver } from '../src/platform/computerUse.ts';
import { linuxSessionEnv, parseEnvBlock, serviceSessionReport } from '../src/platform/linux.ts';
import { darwin } from '../src/platform/darwin.ts';

// What `systemctl --user show-environment` prints once a KDE Wayland desktop has logged in.
const SYSTEMD_KDE = `HOME=/home/u
LANG=en_US.UTF-8
PATH=/usr/local/bin:/usr/bin
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
DISPLAY=:1
WAYLAND_DISPLAY=wayland-0
XDG_CURRENT_DESKTOP=KDE
XDG_SESSION_TYPE=wayland
XDG_RUNTIME_DIR=/run/user/1000
`;
// A hub started at boot by linger: no desktop variables at all.
const LINGER_HUB = { HOME: '/home/u', PATH: '/usr/bin', XDG_RUNTIME_DIR: '/run/user/1000' };

test('show-environment parsing undoes systemd quoting', () => {
  const e = parseEnvBlock(`A=plain\nB=$'two words'\nC=$'tab\\there\\nnext'\nD=$'it\\'s'\nE=$'\\x41\\101'\nnot a line\n`);
  assert.deepEqual(e, { A: 'plain', B: 'two words', C: 'tab\there\nnext', D: "it's", E: 'AA' });
});

test('a hub without a desktop takes the session from systemd, as one set', () => {
  const { env, fromSystemd } = desktopSessionEnv(LINGER_HUB, parseEnvBlock(SYSTEMD_KDE));
  assert.deepEqual(fromSystemd, {
    DISPLAY: ':1',
    WAYLAND_DISPLAY: 'wayland-0',
    XDG_SESSION_TYPE: 'wayland',
    XDG_CURRENT_DESKTOP: 'KDE',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
  });
  assert.equal(env.PATH, '/usr/bin'); // the hub's own values are kept
  assert.equal(env.HOME, '/home/u');
  assert.equal(selectComputerDriver(env, (b) => b === 'spectacle').id, 'wayland-kde');
  // ssh/tty leftovers in the hub do not mix with the systemd display.
  const tty = desktopSessionEnv({ ...LINGER_HUB, XDG_SESSION_TYPE: 'tty' }, parseEnvBlock(SYSTEMD_KDE));
  assert.equal(tty.env.XDG_SESSION_TYPE, 'wayland');
});

test('a hub that already sees a display keeps its own values; only a missing D-Bus address is filled', () => {
  const proc = { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11', XDG_CURRENT_DESKTOP: 'X-Cinnamon' };
  const { env, fromSystemd } = desktopSessionEnv(proc, parseEnvBlock(SYSTEMD_KDE));
  assert.deepEqual(fromSystemd, { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' });
  assert.equal(env.DISPLAY, ':0');
  assert.equal(env.WAYLAND_DISPLAY, undefined);
  assert.equal(needsSessionEnv({ ...proc, DBUS_SESSION_BUS_ADDRESS: 'x' }), false);
  assert.equal(needsSessionEnv(LINGER_HUB), true);
});

test('nothing in systemd either (nobody logged in): nothing is invented', () => {
  const { env, fromSystemd } = desktopSessionEnv(LINGER_HUB, { HOME: '/home/u' });
  assert.deepEqual(fromSystemd, {});
  assert.equal(selectComputerDriver(env, () => true).id, 'none');
});

test('the hub environment is not changed', async () => {
  const proc: Record<string, string> = { DISPLAY: ':5', DBUS_SESSION_BUS_ADDRESS: 'x' };
  const before = JSON.stringify(proc);
  const r = await linuxSessionEnv(proc); // nothing missing: systemd is not asked
  assert.equal(r.env, proc);
  assert.deepEqual(r.fromSystemd, {});
  desktopSessionEnv(LINGER_HUB, parseEnvBlock(SYSTEMD_KDE));
  assert.deepEqual(LINGER_HUB, { HOME: '/home/u', PATH: '/usr/bin', XDG_RUNTIME_DIR: '/run/user/1000' });
  assert.equal(JSON.stringify(proc), before);
});

test('doctor: what the service will find in systemd', () => {
  const shellKde = selectComputerDriver(parseEnvBlock(SYSTEMD_KDE), (b) => b === 'spectacle');
  const missing = serviceSessionReport({ HOME: '/home/u' }, shellKde);
  assert.ok(missing.startsWith('!systemd --user has no DISPLAY or WAYLAND_DISPLAY yet'));
  assert.match(missing, /systemctl --user import-environment DISPLAY WAYLAND_DISPLAY XDG_SESSION_TYPE XDG_CURRENT_DESKTOP DBUS_SESSION_BUS_ADDRESS \(no restart needed\)/);
  assert.ok(!missing.includes('cmc restart'));
  const x11 = selectComputerDriver({ DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' }, () => true);
  assert.match(serviceSessionReport(parseEnvBlock(SYSTEMD_KDE), x11), /^!systemd --user gives "wayland-kde", this shell "x11"/);
});

test('macOS computer-use plan carries no extra environment', async () => {
  const plan = await darwin.computerUse({ useChrome: true });
  assert.equal('env' in plan, false);
});
