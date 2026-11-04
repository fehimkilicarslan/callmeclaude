import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectComputerDriver, uinputSteps, ydotoolTooOld, ydotoolVersion, YDOTOOL_REQUIRED } from '../src/platform/computerUse.ts';
import { linuxComputerDriver } from '../src/platform/linux.ts';

test('ydotool version from the package manager (epoch and release stripped)', () => {
  assert.deepEqual(ydotoolVersion({ pkg: 'ydotool 1:1.0.4-2' }), { version: '1.0.4', major: 1, supported: true }); // pacman -Q
  assert.deepEqual(ydotoolVersion({ pkg: '0.1.8-3' }), { version: '0.1.8', major: 0, supported: false }); // Ubuntu 22.04 dpkg-query
  assert.deepEqual(ydotoolVersion({ pkg: '1.0.4' }), { version: '1.0.4', major: 1, supported: true }); // rpm
  // The package version wins over the CLI output.
  assert.equal(ydotoolVersion({ pkg: '0.1.8-3', cli: 'Available commands:\n  bakers\n' }).supported, false);
});

test('ydotool version from the CLI: a version number, then the command list', () => {
  assert.equal(ydotoolVersion({ cli: 'ydotoold version: v1.0.4\n' }).version, '1.0.4');
  assert.equal(ydotoolVersion({ cli: 'ydotool 0.1.9\n' }).supported, false);
  // 1.x help: no version number, but its command list.
  const v1 = ydotoolVersion({ cli: 'Usage: ydotool <cmd> <args>\nAvailable commands:\n  click\n  mousemove\n  type\n  key\n  debug\n  bakers\nUse environment variable YDOTOOL_SOCKET to specify daemon socket.\n' });
  assert.deepEqual(v1, { major: 1, supported: true });
  // 0.1.x help.
  assert.deepEqual(ydotoolVersion({ cli: 'Usage: ydotool <cmd> <args>\nAvailable commands:\n  click\n  getmouselocation\n  key\n  mousemove\n  recorder\n  type\n' }), { major: 0, supported: false });
  // Unknown output: not trusted.
  assert.deepEqual(ydotoolVersion({ cli: '' }), { supported: false });
  // Hex key codes in help text are not versions.
  assert.equal(ydotoolVersion({ cli: 'click 0xC0' }).version, undefined);
  assert.equal(ydotoolVersion({ pkg: 'not-installed', cli: 'bakers' }).supported, true);
});

test('a ydotool that is not 1.x is ignored by driver selection', () => {
  const KDE = { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', XDG_CURRENT_DESKTOP: 'KDE', PATH: '/nonexistent' };
  // No binary on this PATH at all: absent whatever the probe says.
  assert.equal(linuxComputerDriver(KDE, { version: '1.0.4', major: 1, supported: true }).input, null);
  // Driver selection itself: the Linux `has` answers false for an old ydotool, so it is listed as missing.
  const old = selectComputerDriver(KDE, (b) => b === 'spectacle');
  assert.equal(old.input, null);
  assert.deepEqual(old.missing, [{ tool: 'ydotool', purpose: 'input' }]);
});

test('doctor says "ydotool 1.x required" for an old ydotool and does not suggest reinstalling the same package', () => {
  const v = ydotoolVersion({ pkg: '0.1.8-3' });
  assert.ok(ydotoolTooOld(v).startsWith(`${YDOTOOL_REQUIRED} (found ydotool 0.1.8)`));
  const steps = uinputSteps('apt', 'u', { installed: false, uinput: true, daemon: false, userUnit: false, tooOld: v });
  assert.ok(steps[0].startsWith('ydotool 1.x required'));
  assert.ok(!steps.includes('sudo apt install ydotool'));
  assert.match(ydotoolTooOld({ supported: false }), /version could not be read/);
});
