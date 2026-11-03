// Test helper: acts as the phone app over the WebSocket and answers pending decisions by "tapping" buttons.
// usage: node --import tsx scripts/fake-phone.mts "<note for first stop>"
import WebSocket from 'ws';
import { loadConfig } from '../src/config.ts';
const cfg = loadConfig();
const note = process.argv[2] ?? 'Evet, devam et.';
const ws = new WebSocket(`ws://127.0.0.1:${cfg.appPort}`);
const done = new Set<string>();
let stops = 0;
ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: cfg.appToken, device: 'fake-phone', v: 1 })));
ws.on('message', (d, bin) => {
  if (bin) return;
  const m = JSON.parse(d.toString());
  if (m.type === 'call.incoming') console.log('RING', m.title);
  const snap = m.snapshot;
  if (!snap) return;
  for (const p of snap.pending) {
    if (done.has(p.id)) continue;
    done.add(p.id);
    console.log('PENDING', p.kind, p.project, '|', p.summary, '| risk', p.risk);
    if (p.kind === 'permission') ws.send(JSON.stringify({ type: 'pending.resolve', pendingId: p.id, decision: 'approve' }));
    else if (stops++ === 0) ws.send(JSON.stringify({ type: 'pending.resolve', pendingId: p.id, decision: 'approve', note }));
    else { ws.send(JSON.stringify({ type: 'pending.resolve', pendingId: p.id, decision: 'release' })); console.log('RELEASED, done'); setTimeout(() => process.exit(0), 500); }
  }
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 8 * 60_000);
