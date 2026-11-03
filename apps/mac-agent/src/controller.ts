import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.ts';
import { norm, type Pending, type Session, type State } from './state.ts';
import { audit, execFileP, log } from './util.ts';

export type Delivery = 'hold' | 'tmux' | 'resume' | 'queue' | 'none';

const PREFIX = 'The developer said by phone (via CallMeClaude): ';

/**
 * Gets developer instructions into Claude Code sessions, trying in order:
 *  1. answer a held-open Stop hook with decision=block (Claude continues with our reason)
 *  2. tmux send-keys into the pane the session runs in
 *  3. headless `claude -p --resume` if the session process has ended
 *  4. queue for the session's next hook event
 */
export class Controller {
  constructor(
    private st: State,
    private cfg: Config,
  ) {}

  private resolvePending(p: Pending | undefined, resolution: string) {
    if (!p) return;
    p.status = 'resolved';
    audit('pending.resolved', { pendingId: p.id, project: p.project, resolution });
  }

  private takeHold(sessionId: string) {
    const h = this.st.holdForSession(sessionId);
    if (!h) return;
    clearTimeout(h.timer);
    this.st.holds.delete(h.pendingId);
    return h;
  }

  async instruct(s: Session, text: string): Promise<Delivery> {
    audit('instruct', { session: s.id, project: s.project, text });
    // The phone instruction is now the developer's latest request (the classifier judges against it).
    s.lastPrompt = `${s.lastPrompt ? `(previous task: ${s.lastPrompt.slice(0, 300)}) ` : ''}New instruction by phone: ${text}`;
    const hold = this.takeHold(s.id);
    if (hold) {
      const pend = this.st.pending.get(hold.pendingId);
      if (hold.kind === 'stop') {
        hold.respond({ decision: 'block', reason: PREFIX + text });
      } else {
        // Permission prompt + free-form instruction: deny the tool with the instruction as guidance.
        hold.respond({
          hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: PREFIX + text } },
        });
      }
      this.resolvePending(pend, `instruction: ${text}`);
      this.mark(s, 'running', 'Instruction delivered, working.');
      return 'hold';
    }
    if (s.tmuxPane && (await this.tmuxAlive(s.tmuxPane))) {
      await this.tmuxType(s.tmuxPane, text);
      this.mark(s, 'running', 'Instruction delivered, working.');
      return 'tmux';
    }
    if (s.state === 'ended') {
      this.resumeHeadless(s, text);
      this.mark(s, 'running', 'Session resumed, working.');
      return 'resume';
    }
    const q = this.st.queued.get(s.id) ?? [];
    q.push(text);
    this.st.queued.set(s.id, q);
    this.st.changed();
    return 'queue';
  }

  /** Approve or deny a held permission prompt. */
  permission(s: Session, allow: boolean, note?: string): boolean {
    const hold = this.st.holdForSession(s.id);
    if (!hold || hold.kind !== 'permission') return false;
    this.takeHold(s.id);
    hold.respond({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: allow ? { behavior: 'allow' } : { behavior: 'deny', message: note ? PREFIX + note : 'The developer declined.' },
      },
    });
    this.resolvePending(this.st.pending.get(hold.pendingId), allow ? 'approved' : `denied ${note ?? ''}`);
    this.mark(s, 'running', allow ? 'Permission granted, working.' : 'Permission denied.');
    return true;
  }

  /** Let a held session stop normally (developer: "tamam, bu kadar"). */
  release(s: Session): boolean {
    const hold = this.takeHold(s.id);
    if (!hold) return false;
    hold.respond({});
    this.resolvePending(this.st.pending.get(hold.pendingId), 'released');
    this.st.changed();
    return true;
  }

  async interrupt(s: Session) {
    const hold = this.takeHold(s.id);
    if (hold) {
      hold.respond(
        hold.kind === 'permission'
          ? { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Stopped by the developer.', interrupt: true } } }
          : { continue: false, stopReason: 'CallMeClaude: stopped by the developer' },
      );
      this.resolvePending(this.st.pending.get(hold.pendingId), 'interrupted');
    }
    if (s.tmuxPane) await execFileP('tmux', ['send-keys', '-t', s.tmuxPane, 'Escape']).catch(() => {});
    this.st.queued.delete(s.id);
    audit('interrupt', { session: s.id, project: s.project });
    this.mark(s, 'waiting_input', 'Stopped.');
  }

  async panic() {
    this.st.paused = true;
    for (const s of this.st.activeSessions()) await this.interrupt(s);
    audit('panic', {});
    this.st.changed();
  }

  /** Start a new interactive Claude Code session in a detached tmux session. */
  async startSession(dir: string, task: string): Promise<string> {
    const name = 'cmc-' + norm(dir.split('/').pop() ?? 'oturum').slice(0, 20) + '-' + Date.now().toString(36).slice(-4);
    await execFileP('tmux', ['new-session', '-d', '-s', name, '-c', dir, '-x', '200', '-y', '50', 'claude', task]);
    audit('session.start', { dir, task, tmux: name });
    void this.acceptTrustPrompt(name, dir);
    return name;
  }

  /**
   * A first-time folder shows Claude Code's "do you trust this folder?" prompt, which would stall a
   * voice-started session. The developer asked for this folder by voice, so accept it — but only for
   * folders inside the configured project roots.
   */
  private async acceptTrustPrompt(target: string, dir: string) {
    const inRoots = this.cfg.projectRoots.some((r) => dir === r || dir.startsWith(r + '/'));
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      let screen = '';
      try {
        screen = (await execFileP('tmux', ['capture-pane', '-p', '-t', target])).stdout;
      } catch {
        return;
      }
      if (/Yes, I trust this folder/.test(screen)) {
        if (!inRoots) {
          audit('session.trust.skipped', { dir });
          return;
        }
        await execFileP('tmux', ['send-keys', '-t', target, 'Down', 'Enter']);
        audit('session.trust.accepted', { dir });
        return;
      }
      if (/❯\s*$|auto mode|bypass permissions|accept edits/m.test(screen)) return; // already in the prompt UI
    }
  }

  private resumeHeadless(s: Session, text: string) {
    const child = spawn('claude', ['-p', '--resume', s.id, '--permission-mode', 'acceptEdits', PREFIX + text], {
      cwd: s.cwd,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    audit('session.resume', { session: s.id, text });
  }

  private async tmuxAlive(pane: string) {
    try {
      await execFileP('tmux', ['display-message', '-p', '-t', pane, '#{pane_id}']);
      return true;
    } catch {
      return false;
    }
  }

  private async tmuxType(pane: string, text: string) {
    await execFileP('tmux', ['send-keys', '-t', pane, '-l', PREFIX + text]);
    await new Promise((r) => setTimeout(r, 150));
    await execFileP('tmux', ['send-keys', '-t', pane, 'Enter']);
  }

  private mark(s: Session, state: Session['state'], summary: string) {
    s.state = state;
    s.summary = summary;
    s.updatedAt = new Date().toISOString();
    this.st.changed();
  }

  /** Resolve a spoken project name to a directory under the configured roots. */
  findProjectDir(q: string): string | undefined {
    if (q.startsWith('/') && existsSync(q)) return q;
    const n = norm(q);
    const known = this.st.findSession(q);
    if (known && existsSync(known.cwd)) return known.cwd;
    let best: string | undefined;
    for (const root of this.cfg.projectRoots) {
      let entries: string[] = [];
      try {
        entries = readdirSync(root);
      } catch {
        continue;
      }
      for (const e of entries) {
        const p = join(root, e);
        try {
          if (!statSync(p).isDirectory()) continue;
        } catch {
          continue;
        }
        const en = norm(e);
        if (en === n) return p;
        if (!best && (en.includes(n) || n.includes(en))) best = p;
      }
    }
    if (!best) log.info('project not found', q);
    return best;
  }
}
