// Desk phone: acts as the phone app on Linux and carries the call audio through PipeWire
// (pw-record → hub at 16 kHz, hub → pw-play at 24 kHz). Reference client for the iOS / Android apps.
// Use headphones: there is no echo cancellation, so speaker audio would leak back into the mic.
//
// usage: node --import tsx scripts/desk-phone.mts [options]
//   (default)          wait for the hub to ring (`cmc call-me`) and answer automatically; keeps waiting after a call
//   --call             place a call to the hub as soon as connected; exits when the call ends
//   --input <wav>      send this PCM16 16 kHz mono wav instead of the mic (real-time pace), then silence
//   --record-out <wav> also write the received assistant audio (24 kHz) to this wav
//   --no-speaker       do not play the assistant audio (handy for scripted runs)
//   --url <ws://..>    hub address (default ws://127.0.0.1:<appPort> from the config / CMC_HOME)
//   --token <t>        app token (default appToken from the config)
// Ctrl+C sends call.end, stops pw-record / pw-play and exits.
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync, readFileSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import WebSocket from 'ws';
import { MIC_SAMPLE_RATE, SPEAKER_SAMPLE_RATE, type AppToHub, type HubToApp } from '@callmeclaude/protocol';
import { callEndedKind, EndedCalls } from './desk-phone-calls.ts';

const { values: opt } = parseArgs({
  options: {
    call: { type: 'boolean', default: false },
    input: { type: 'string' },
    'record-out': { type: 'string' },
    'no-speaker': { type: 'boolean', default: false },
    url: { type: 'string' },
    token: { type: 'string' },
  },
});

let url = opt.url;
let token = opt.token;
if (!url || !token) {
  const { loadConfig } = await import('../src/config.ts');
  const cfg = loadConfig();
  url ??= `ws://127.0.0.1:${cfg.appPort}`;
  token ??= cfg.appToken;
}

// iOS: AVAudioEngine input tap of 1024 frames at the 48 kHz session rate, converted to 16 kHz
// → ~341 samples (682 bytes, ~21.3 ms) per binary frame, sent as soon as each tap fires.
const FRAME_SAMPLES = 341;
const FRAME_BYTES = FRAME_SAMPLES * 2;
const FRAME_MS = (FRAME_SAMPLES / MIC_SAMPLE_RATE) * 1000;
const READY_TIMEOUT_MS = 15_000; // iOS gives up on "connecting…" after 15 s
const PING_EVERY_MS = 8_000; // iOS: WebSocket ping every 8 s, drop if no pong within 6 s
const PING_TIMEOUT_MS = 6_000;

const t0 = Date.now();
const ts = () => `+${((Date.now() - t0) / 1000).toFixed(2)}s`;
const isTTY = process.stdout.isTTY;
let partialShown = false;
function say(line: string) {
  if (partialShown) process.stdout.write('\r\x1b[2K');
  partialShown = false;
  console.log(`${ts()} ${line}`);
}

interface Call {
  callId: string;
  /** Hub's perspective, as on iOS: 'outbound' = hub called us, 'inbound' = we called the hub. */
  direction: 'inbound' | 'outbound';
  ready: boolean;
  startedAt: number;
  readyAt?: number;
  firstAudioAt?: number;
  rxBytes: number;
  flushes: number;
  readyTimer?: NodeJS.Timeout;
}

let ws: WebSocket | undefined;
let call: Call | undefined;
/** Calls we have ended, so the hub's confirming call.ended is not reported as "other call". */
const ended = new EndedCalls();
let quitting = false;

// ---------- connection ----------

function connect() {
  const sock = new WebSocket(url!, { maxPayload: 4 << 20 });
  ws = sock;
  let pingTimer: NodeJS.Timeout | undefined;
  let pongDeadline: NodeJS.Timeout | undefined;
  sock.on('open', () => send({ type: 'auth', token: token!, device: 'desk-phone', v: 1 }));
  sock.on('pong', () => clearTimeout(pongDeadline));
  sock.on('message', (d, bin) => {
    if (bin) return onAudio(d as Buffer);
    let m: HubToApp;
    try {
      m = JSON.parse(d.toString());
    } catch {
      return;
    }
    if (m.type === 'hello') {
      say(`connected to ${url} (hub ${m.snapshot.hubVersion}, mode ${m.snapshot.mode}, ${m.snapshot.language})`);
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        sock.ping();
        clearTimeout(pongDeadline);
        pongDeadline = setTimeout(() => sock.terminate(), PING_TIMEOUT_MS);
      }, PING_EVERY_MS);
    }
    onControl(m);
  });
  sock.on('close', (code, reason) => {
    clearInterval(pingTimer);
    clearTimeout(pongDeadline);
    if (ws !== sock) return;
    ws = undefined;
    if (quitting) return;
    if (code === 4003) {
      say('hub rejected the token (4003 bad token)');
      return shutdown(1);
    }
    // Like iOS: keep the call on our side and re-attach with the same callId after reconnecting.
    say(`connection closed (${code} ${reason.toString()}), reconnecting…`);
    setTimeout(connect, call ? 500 : 3000);
  });
  sock.on('error', (e) => say(`socket error: ${e.message}`));
}

function send(m: AppToHub) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

function onControl(m: HubToApp) {
  switch (m.type) {
    case 'hello':
      if (call) {
        say(`re-attaching to ${call.callId}`);
        send({ type: 'call.start', callId: call.callId, direction: call.direction });
      } else if (opt.call) {
        startCall('c_' + randomUUID().slice(0, 8), 'inbound');
      } else {
        say('waiting for a call (ring it with `cmc call-me`)…');
      }
      return;
    case 'call.incoming':
      if (call) {
        if (call.callId === m.callId) return;
        say(`incoming ${m.callId} while busy with ${call.callId} → declined`);
        return send({ type: 'call.end', callId: m.callId });
      }
      say(`RING ${m.callId} "${m.title}" → answering`);
      return startCall(m.callId, 'outbound');
    case 'call.ready': {
      if (!call || call.callId !== m.callId) return;
      if (call.ready) return say(`call.ready ${m.callId} (re-attached)`);
      call.ready = true;
      call.readyAt = Date.now();
      clearTimeout(call.readyTimer);
      say(`call.ready ${m.callId} after ${call.readyAt - call.startedAt} ms`);
      startMic();
      return;
    }
    case 'call.ended': {
      const kind = callEndedKind(call?.callId, m.callId, ended);
      if (kind === 'own') return;
      if (kind === 'other') return say(`ignoring call.ended for other call ${m.callId} (${m.reason})`);
      say(`call.ended ${m.callId}: ${m.reason}`);
      return endCall(false);
    }
    case 'audio.flush':
      if (call) call.flushes++;
      say('audio.flush → dropping queued assistant audio');
      return speaker.flush();
    case 'transcript': {
      const line = `[${m.role}] ${m.text}`;
      if (m.final) return say(`${line}`);
      if (isTTY) {
        process.stdout.write(`\r\x1b[2K${ts()} … ${line}`.slice(0, (process.stdout.columns || 120) - 1));
        partialShown = true;
      } else say(`… ${line}`);
      return;
    }
    case 'error':
      return say(`hub error: ${m.message}`);
    case 'heartbeat':
    case 'snapshot':
      return;
  }
}

// ---------- call lifecycle ----------

function startCall(callId: string, direction: Call['direction']) {
  call = { callId, direction, ready: false, startedAt: Date.now(), rxBytes: 0, flushes: 0 };
  if (opt['record-out']) recorder = new WavWriter(opt['record-out'], SPEAKER_SAMPLE_RATE);
  say(`call.start ${callId} (${direction})`);
  send({ type: 'call.start', callId, direction });
  const c = call;
  c.readyTimer = setTimeout(() => {
    if (call !== c || c.ready) return;
    say(`call ${callId} not ready after ${READY_TIMEOUT_MS / 1000}s → hanging up`);
    endCall(true);
  }, READY_TIMEOUT_MS);
}

/** Ends the call locally; `notifyHub` = we are the one hanging up. */
function endCall(notifyHub: boolean) {
  const c = call;
  if (!c) return;
  call = undefined;
  ended.add(c.callId);
  clearTimeout(c.readyTimer);
  if (notifyHub) send({ type: 'call.end', callId: c.callId });
  stopMic();
  speaker.stop();
  const rec = recorder?.close();
  recorder = undefined;
  const first = c.firstAudioAt ? `${c.firstAudioAt - c.startedAt} ms after call.start` + (c.readyAt ? `, ${c.firstAudioAt - c.readyAt} ms after call.ready` : '') : 'none';
  say(`stats ${c.callId}: first assistant audio ${first}; received ${c.rxBytes} bytes (${(c.rxBytes / (SPEAKER_SAMPLE_RATE * 2)).toFixed(2)} s); flushes ${c.flushes}; mic sent ${(micSent / (MIC_SAMPLE_RATE * 2)).toFixed(2)} s`);
  if (rec) say(`recorded ${rec.bytes} bytes (${(rec.bytes / (SPEAKER_SAMPLE_RATE * 2)).toFixed(2)} s) → ${rec.path}`);
  micSent = 0;
  if (opt.call && !quitting) shutdown(0);
}

// ---------- microphone (or wav) → hub ----------

let micProc: ChildProcess | undefined;
let micTimer: NodeJS.Timeout | undefined;
let micSent = 0;

function sendMic(frame: Buffer) {
  if (!call || ws?.readyState !== WebSocket.OPEN) return;
  ws.send(frame, { binary: true });
  micSent += frame.length;
}

function startMic() {
  stopMic();
  if (opt.input) return startWav(opt.input);
  micProc = spawn('pw-record', ['--rate', String(MIC_SAMPLE_RATE), '--channels', '1', '--format', 's16', '--raw', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let acc: Buffer = Buffer.alloc(0);
  micProc.stdout!.on('data', (d: Buffer) => {
    acc = acc.length ? Buffer.concat([acc, d]) : d;
    while (acc.length >= FRAME_BYTES) {
      sendMic(acc.subarray(0, FRAME_BYTES));
      acc = acc.subarray(FRAME_BYTES);
    }
  });
  micProc.on('error', (e) => say(`pw-record failed: ${e.message}`));
  const p = micProc;
  micProc.on('exit', (code, sig) => micProc === p && call && say(`pw-record exited (${code ?? sig})`));
  say('mic: pw-record 16 kHz mono s16');
}

/** Sends the wav at real-time pace in iOS-sized frames, then keeps streaming silence (the hub ends calls after 20 s without mic audio). */
function startWav(path: string) {
  const pcm = readWavPcm16Mono(path, MIC_SAMPLE_RATE);
  const silence = Buffer.alloc(FRAME_BYTES);
  let off = 0;
  let frames = 0;
  const start = Date.now();
  say(`mic: ${path} (${(pcm.length / (MIC_SAMPLE_RATE * 2)).toFixed(2)} s), then silence`);
  micTimer = setInterval(() => {
    // Catch up on timer drift so the average rate is exactly real time.
    const due = Math.floor((Date.now() - start) / FRAME_MS);
    while (frames < due) {
      frames++;
      if (off < pcm.length) {
        const chunk = pcm.subarray(off, off + FRAME_BYTES);
        off += FRAME_BYTES;
        sendMic(chunk.length === FRAME_BYTES ? chunk : Buffer.concat([chunk, silence.subarray(chunk.length)]));
        if (off >= pcm.length) say('mic: input file done, sending silence');
      } else sendMic(silence);
    }
  }, Math.floor(FRAME_MS / 2));
}

function stopMic() {
  clearInterval(micTimer);
  micTimer = undefined;
  micProc?.kill('SIGTERM');
  micProc = undefined;
}

function readWavPcm16Mono(path: string, rate: number): Buffer {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path}: not a RIFF/WAVE file`);
  let fmt: { format: number; channels: number; rate: number; bits: number } | undefined;
  for (let p = 12; p + 8 <= b.length; ) {
    const id = b.toString('ascii', p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(p + 8), channels: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.channels !== 1 || fmt.bits !== 16 || fmt.rate !== rate)
        throw new Error(`${path}: need PCM16 mono ${rate} Hz, got ${JSON.stringify(fmt)} (convert: ffmpeg -i in -ac 1 -ar ${rate} -c:a pcm_s16le out.wav)`);
      return b.subarray(p + 8, Math.min(b.length, p + 8 + size));
    }
    p += 8 + size + (size & 1);
  }
  throw new Error(`${path}: no data chunk`);
}

// ---------- hub → speaker (and wav) ----------

/**
 * pw-play is fed as fast as audio arrives; the pipe and pw-play hold the queue.
 * audio.flush kills pw-play, which drops everything queued at once (like AVAudioPlayerNode.stop()+play() on iOS);
 * the next chunk starts a fresh pw-play.
 */
const speaker = {
  proc: undefined as ChildProcess | undefined,
  play(pcm: Buffer) {
    if (opt['no-speaker']) return;
    if (!this.proc) {
      const p = spawn('pw-play', ['--rate', String(SPEAKER_SAMPLE_RATE), '--channels', '1', '--format', 's16', '--raw', '-'], { stdio: ['pipe', 'ignore', 'inherit'] });
      p.on('error', (e) => say(`pw-play failed: ${e.message}`));
      p.stdin!.on('error', () => {}); // EPIPE after a flush kill
      p.on('exit', () => this.proc === p && (this.proc = undefined));
      this.proc = p;
    }
    this.proc.stdin!.write(pcm);
  },
  flush() {
    this.stop();
  },
  stop() {
    const p = this.proc;
    this.proc = undefined;
    if (!p) return;
    p.stdin!.destroy();
    p.kill('SIGKILL');
  },
};

class WavWriter {
  private fd: number;
  bytes = 0;
  constructor(readonly path: string, private rate: number) {
    this.fd = openSync(path, 'w');
    writeSync(this.fd, this.header(0));
  }
  private header(dataLen: number) {
    const h = Buffer.alloc(44);
    h.write('RIFF', 0, 'ascii');
    h.writeUInt32LE(36 + dataLen, 4);
    h.write('WAVEfmt ', 8, 'ascii');
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20); // PCM
    h.writeUInt16LE(1, 22); // mono
    h.writeUInt32LE(this.rate, 24);
    h.writeUInt32LE(this.rate * 2, 28);
    h.writeUInt16LE(2, 32);
    h.writeUInt16LE(16, 34);
    h.write('data', 36, 'ascii');
    h.writeUInt32LE(dataLen, 40);
    return h;
  }
  write(pcm: Buffer) {
    writeSync(this.fd, pcm);
    this.bytes += pcm.length;
  }
  close() {
    writeSync(this.fd, this.header(this.bytes), 0, 44, 0);
    closeSync(this.fd);
    return { path: this.path, bytes: this.bytes };
  }
}

// Opened per call; a second call in wait mode overwrites the file.
let recorder: WavWriter | undefined;

function onAudio(pcm: Buffer) {
  if (!call) return;
  if (!call.firstAudioAt) {
    call.firstAudioAt = Date.now();
    say(`first assistant audio after ${call.firstAudioAt - call.startedAt} ms`);
  }
  call.rxBytes += pcm.length;
  recorder?.write(pcm);
  speaker.play(pcm);
}

// ---------- shutdown ----------

function shutdown(code: number) {
  if (quitting) return;
  quitting = true;
  endCall(true);
  const sock = ws;
  if (!sock || sock.readyState !== WebSocket.OPEN) return process.exit(code);
  sock.once('close', () => process.exit(code));
  sock.close(1000, 'bye');
  setTimeout(() => process.exit(code), 1000).unref();
}

let sigints = 0;
process.on('SIGINT', () => {
  if (sigints++) process.exit(130);
  say('Ctrl+C → hanging up');
  shutdown(0);
});
process.on('SIGTERM', () => shutdown(0));
for (const bin of opt.input ? ['pw-play'] : ['pw-record', 'pw-play']) {
  if (bin === 'pw-play' && opt['no-speaker']) continue;
  const r = spawn(bin, ['--version'], { stdio: 'ignore' });
  r.on('error', () => {
    console.error(`${bin} not found: install PipeWire tools (Arch: pipewire, Debian/Ubuntu: pipewire-bin)`);
    process.exit(1);
  });
}
console.log('🎧 Use headphones: there is no echo cancellation, speaker audio would leak back into the mic.');
connect();
