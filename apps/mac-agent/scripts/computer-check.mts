// Smoke test for the hub's computer-use path (read-only task).
import { computerTask } from '../src/brain.ts';
import { loadConfig, ensureDirs } from '../src/config.ts';
ensureDirs();
const cfg = loadConfig();
const hub: any = { cfg, st: { findSession: () => undefined } };
const t = Date.now();
console.log(await computerTask(hub, process.argv[2] ?? 'Which app and window are in front? Just look and tell me; do not click or type anything.'));
console.log('took', Math.round((Date.now() - t) / 1000), 's');
process.exit(0);
