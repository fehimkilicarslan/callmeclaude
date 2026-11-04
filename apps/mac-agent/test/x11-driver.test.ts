// X11 computer-use driver on a real (virtual) X server. Starts its OWN Xvfb on a free display, so it never
// sends input to the developer's desktop. Skipped when Xvfb/xdotool/scrot are missing, unless
// CMC_REQUIRE_X11=1 (CI), where missing tools are a failure. -noreset: without it Xvfb resets (pointer back
// to the centre) whenever its last client disconnects, i.e. after every single xdotool call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { screenshotCommand, selectComputerDriver } from '../src/platform/computerUse.ts';
import { onPath } from '../src/platform/linux.ts';

const run = promisify(execFile);
const need = ['Xvfb', 'xdotool', 'scrot'];
const missing = process.platform === 'linux' ? need.filter((b) => !onPath(b)) : need;
const required = process.env.CMC_REQUIRE_X11 === '1';
const skip = !required && missing.length ? `needs ${missing.join(', ')}` : false;

const W = 1280;
const H = 800;

async function startXvfb(): Promise<{ proc: ChildProcess; display: string }> {
  const proc = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', `${W}x${H}x24`, '-nolisten', 'tcp', '-noreset'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
  const display = await new Promise<string>((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('Xvfb did not start')), 10_000);
    (proc.stdio[3] as NodeJS.ReadableStream).on('data', (d) => {
      buf += d;
      const m = buf.match(/^(\d+)\n/);
      if (m) {
        clearTimeout(t);
        resolve(':' + m[1]);
      }
    });
    proc.on('exit', (c) => reject(new Error(`Xvfb exited ${c}`)));
  });
  return { proc, display };
}

test('X11 driver under Xvfb: screenshot is a PNG of the screen, mousemove lands on the pixel', { skip }, async () => {
  assert.deepEqual(missing, [], `missing tools: ${missing.join(', ')}`);
  const { proc, display } = await startXvfb();
  const dir = mkdtempSync(join(tmpdir(), 'cmc-x11-it-'));
  // The hub's own view of this session: X11, no Wayland, whatever desktop the runner has.
  const env: NodeJS.ProcessEnv = { ...process.env, DISPLAY: display, XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: '' };
  const sh = (cmd: string) => run('/bin/sh', ['-c', cmd], { env, timeout: 15_000 });
  try {
    const d = selectComputerDriver(env, (b) => onPath(b, env.PATH));
    assert.equal(d.id, 'x11');
    assert.equal(d.input, 'xdotool');
    assert.ok(d.screenshot);

    const file = join(dir, '1.png');
    await sh(screenshotCommand('scrot', file));
    const png = readFileSync(file);
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
    // IHDR width/height = the X screen: screenshot pixels and X11 coordinates share one space.
    assert.equal(png.readUInt32BE(16), W);
    assert.equal(png.readUInt32BE(20), H);
    await sh(`rm -f ${file}`);
    assert.ok(!existsSync(file));

    for (const [x, y] of [
      [300, 200], // not the centre: that is where Xvfb starts the pointer
      [17, 23],
      [W - 1, H - 1],
    ]) {
      await sh(`xdotool mousemove ${x} ${y}`);
      const { stdout } = await sh('xdotool getmouselocation --shell');
      assert.match(stdout, new RegExp(`^X=${x}$`, 'm'));
      assert.match(stdout, new RegExp(`^Y=${y}$`, 'm'));
    }
  } finally {
    proc.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
