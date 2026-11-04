// Pure call bookkeeping for scripts/desk-phone.mts (kept apart so it can be tested without a hub or PipeWire).

/** Ids of calls this desk phone has already ended (newest last, a few kept). */
export class EndedCalls {
  private ids: string[] = [];
  constructor(private readonly keep = 8) {}
  add(callId: string) {
    this.ids = [...this.ids.filter((x) => x !== callId), callId].slice(-this.keep);
  }
  has(callId: string) {
    return this.ids.includes(callId);
  }
}

/**
 * What a `call.ended` from the hub means here: 'end' = the call in progress, 'own' = a call we already ended
 * (e.g. we hung up on Ctrl+C and the hub confirms it: nothing to say), 'other' = some other call.
 */
export function callEndedKind(current: string | undefined, callId: string, ended: Pick<EndedCalls, 'has'>): 'end' | 'own' | 'other' {
  if (current === callId) return 'end';
  if (ended.has(callId)) return 'own';
  return 'other';
}
