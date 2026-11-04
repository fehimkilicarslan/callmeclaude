import type { Priority, PushPayload } from '@callmeclaude/protocol';
import { PROTOCOL_VERSION } from '@callmeclaude/protocol';
import { apnsConfigured, sendVoipPush } from './apns.ts';
import type { Hub } from './hub.ts';
import { audit, log, shortId } from './util.ts';

export interface CallItem {
  priority: Priority;
  title: string;
  /** What the voice agent should tell the developer. */
  text: string;
  pendingId?: string;
  /** The developer explicitly asked for this call ("call me when it's done"): ignores quiet modes. */
  requested?: boolean;
}

interface Ringing {
  callId: string;
  items: CallItem[];
  attempts: number;
  timer: NodeJS.Timeout;
}

const RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** Decides when to ring the phone: priorities, batching, quiet modes, retries. */
export class Calls {
  queue: CallItem[] = [];
  ringing?: Ringing;
  lastRingAt = 0;
  private flushTimer?: NodeJS.Timeout;
  private flushAt = 0;

  constructor(private hub: Hub) {}

  /** Items still worth calling about (their decision has not been made elsewhere). */
  openCount() {
    return this.queue.filter((i) => !i.pendingId || this.hub.st.pending.get(i.pendingId)?.status === 'open').length;
  }

  allowed(p: Priority) {
    const m = this.hub.cfg.mode;
    if (p === 'P0') return true;
    if (p === 'P3') return false;
    return m === 'away' || m === 'ride';
  }

  enqueue(item: CallItem) {
    audit('call.enqueue', { ...item });
    // On a live call: just tell the developer now.
    if (this.hub.voice.active) {
      this.hub.voice.active.inject(item.text, item.priority === 'P0' ? 'now' : 'idle');
      return;
    }
    if (!item.requested && !this.allowed(item.priority)) return;
    if (this.ringing) {
      this.ringing.items.push(item);
      return;
    }
    this.queue.push(item);
    const delay = item.priority === 'P0' ? 0 : this.hub.cfg.calls.batchSeconds[item.priority as 'P1' | 'P2'] * 1000;
    this.schedule(delay);
  }

  private schedule(delayMs: number) {
    const at = Date.now() + delayMs;
    if (this.flushTimer && this.flushAt <= at) return;
    clearTimeout(this.flushTimer);
    this.flushAt = at;
    this.flushTimer = setTimeout(() => this.flush(), delayMs);
  }

  private flush() {
    this.flushTimer = undefined;
    if (!this.queue.length || this.hub.voice.active || this.ringing) return;
    // Drop items whose pending was resolved meanwhile (e.g. answered at the keyboard).
    this.queue = this.queue.filter((i) => !i.pendingId || this.hub.st.pending.get(i.pendingId)?.status === 'open');
    if (!this.queue.length) return;
    const urgent = this.queue.some((i) => i.priority === 'P0');
    const gap = this.hub.cfg.calls.minGapSeconds * 1000 - (Date.now() - this.lastRingAt);
    if (!urgent && gap > 0) return this.schedule(gap);
    const items = this.queue.sort((a, b) => RANK[a.priority] - RANK[b.priority]);
    this.queue = [];
    void this.ring(items, 1);
  }

  /** Ring the phone now (also used by `cmc call-me`). */
  async ring(items: CallItem[], attempt: number) {
    const callId = shortId('c_');
    const title = items.length === 1 ? items[0].title : `${items.length} updates`;
    this.lastRingAt = Date.now();
    const timer = setTimeout(() => this.missed(callId), 50_000);
    this.ringing = { callId, items, attempts: attempt, timer };
    audit('call.ring', { callId, title, attempt, items: items.length });

    const viaSocket = this.hub.app.broadcast({ type: 'call.incoming', callId, title });
    let viaPush = false;
    const token = this.hub.app.voipToken();
    if (token && apnsConfigured(this.hub.cfg)) {
      const payload: PushPayload = { cmc: { v: PROTOCOL_VERSION, callId, title, priority: items[0].priority } };
      const r = await sendVoipPush(this.hub.cfg, token, payload);
      viaPush = r.ok;
      if (!r.ok) log.warn('voip push failed', r.status, r.reason);
    }
    if (!viaSocket && !viaPush) log.warn('could not reach phone: no socket and no push (pair the app / configure APNs)');
    return { callId, viaSocket, viaPush };
  }

  private missed(callId: string) {
    const r = this.ringing;
    if (!r || r.callId !== callId) return;
    this.ringing = undefined;
    audit('call.missed', { callId, attempt: r.attempts });
    const retry = r.items.filter((i) => RANK[i.priority] <= 1);
    if (retry.length && r.attempts <= this.hub.cfg.calls.maxRetries) {
      setTimeout(() => {
        if (this.hub.voice.active) return;
        const still = retry.filter((i) => !i.pendingId || this.hub.st.pending.get(i.pendingId)?.status === 'open');
        if (still.length) void this.ring([...still, ...this.queue.splice(0)], r.attempts + 1);
      }, this.hub.cfg.calls.retryMissedAfterSeconds * 1000);
    } else {
      // Keep the rest for the next conversation's briefing.
      this.queue.push(...r.items.filter((i) => RANK[i.priority] <= 2).map((i) => ({ ...i, priority: 'P3' as Priority })));
    }
  }

  /** Called when the phone answers (or the developer calls in). Returns what to talk about. */
  takeAgenda(callId?: string): CallItem[] {
    const items: CallItem[] = [];
    if (this.ringing && (!callId || this.ringing.callId === callId)) {
      clearTimeout(this.ringing.timer);
      items.push(...this.ringing.items);
      this.ringing = undefined;
    }
    items.push(...this.queue.splice(0));
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    return items.filter((i) => !i.pendingId || this.hub.st.pending.get(i.pendingId)?.status === 'open');
  }

  declined(callId: string) {
    if (this.ringing?.callId === callId) this.missed(callId);
  }
}
