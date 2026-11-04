import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inProjectRoots, voiceSessionMode, type Config } from './config.ts';
import { norm, type Pending, type Session, type State } from './state.ts';
import { audit, execFileP, log } from './util.ts';

export type Delivery = 'hold' | 'tmux' | 'resume' | 'queue' | 'none';

const PREFIX = 'The developer said by phone (via CallMeClaude): ';

/** argv for a voice-started headless session: same permission mode as resumeHeadless, session id fixed up front. */
export function headlessStartArgs(sessionId: string, task: string): string[] {
  return ['-p', '--session-id', sessionId, '--permission-mode', 'acceptEdits', task];
}

/**
 * Gets developer instructions into Claude Code sessions, trying in order:
 *  1. answer a held-open Stop hook with decision=block (Claude continues with our reason)
 *  2. tmux send-keys into the pane the session runs in
 *  3. headless `claude -p --resume` if the session process has ended
 *  4. queue for the session's next hook event
 */
export class Controller {
  /** Headless sessions this hub started, by session id (Linux without tmux). */
  private headless = new Map<string, ChildProcess>();

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
    const killed = this.stopHeadless(s.id);
    this.st.queued.delete(s.id);
    audit('interrupt', { session: s.id, project: s.project, ...(killed ? { headless: true } : {}) });
    // A stopped headless process is gone; 'ended' lets the next instruction resume it with --resume.
    this.mark(s, killed ? 'ended' : 'waiting_input', 'Stopped.');
  }

  async panic(source: 'voice' | 'app' | 'cli' = 'cli') {
    this.st.paused = true;
    for (const s of this.st.activeSessions()) await this.interrupt(s);
    audit('panic', { source });
    this.st.changed();
  }

  /**
   * Start a new Claude Code session: a detached tmux session, or headless `claude -p` (Linux without tmux).
   * `onStuck` fires if a tmux session never gets past its startup screens.
   */
  async startSession(dir: string, task: string, onStuck?: (why: string) => void): Promise<string> {
    if (voiceSessionMode(this.cfg) === 'headless') return this.startHeadless(dir, task);
    const name = 'cmc-' + norm(dir.split('/').pop() ?? 'session').slice(0, 20) + '-' + Date.now().toString(36).slice(-4);
    await execFileP('tmux', ['new-session', '-d', '-s', name, '-c', dir, '-x', '200', '-y', '50', 'claude', task]);
    audit('session.start', { dir, task, tmux: name });
    void this.passStartupScreens(name, dir).then((why) => {
      if (why) {
        audit('session.start.stuck', { dir, tmux: name, why });
        onStuck?.(why);
      }
    });
    return name;
  }

  /**
   * Claude Code can open with blocking screens before it starts working: "do you trust this folder?"
   * and "new MCP servers found in this project". Either would stall a voice-started session forever.
   * The developer asked for this folder by voice, so we accept them, but only for folders inside the
   * configured project roots. Returns a reason string if the session is still stuck, else undefined.
   */
  private async passStartupScreens(target: string, dir: string): Promise<string | undefined> {
    const inRoots = inProjectRoots(this.cfg.projectRoots, dir);
    let screen = '';
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        screen = (await execFileP('tmux', ['capture-pane', '-p', '-t', target])).stdout;
      } catch {
        return; // session already gone
      }
      if (/Yes, I trust this folder/.test(screen)) {
        if (!inRoots) return 'waiting for the folder trust prompt (folder is outside projectRoots)';
        await execFileP('tmux', ['send-keys', '-t', target, 'Down', 'Enter']);
        audit('session.trust.accepted', { dir });
        continue;
      }
      if (/new MCP servers? found/i.test(screen)) {
        // Enable the project's own (pre-selected) servers inside trusted roots; reject them elsewhere.
        await execFileP('tmux', ['send-keys', '-t', target, inRoots ? 'Enter' : 'Escape']);
        audit('session.mcp.' + (inRoots ? 'accepted' : 'rejected'), { dir });
        continue;
      }
      // Working (spinner / "esc to interrupt") or sitting at the input prompt: startup is over.
      if (/esc to interrupt|auto mode|bypass permissions|accept edits|^\s*❯\s*$/im.test(screen)) return;
    }
    const tail = screen.trim().split('\n').slice(-4).join(' ').replace(/\s+/g, ' ').slice(0, 160);
    return `still on a startup screen after 90s: ${tail}`;
  }

  /**
   * Linux without tmux: run the session as a detached `claude -p`. Headless mode never shows the folder trust
   * prompt, so the project-roots rule that guards passStartupScreens is enforced here before anything starts.
   */
  private startHeadless(dir: string, task: string): string {
    if (!inProjectRoots(this.cfg.projectRoots, dir)) {
      audit('session.start.refused', { dir, task, reason: 'outside projectRoots' });
      throw new Error(`Not starting a session in ${dir}: it is outside the configured project roots.`);
    }
    const id = randomUUID();
    // No TMUX_PANE: if the hub itself runs inside tmux, the hooks must not report the hub's pane for this session.
    const { TMUX: _t, TMUX_PANE: _p, ...env } = process.env;
    const child = spawn('claude', headlessStartArgs(id, task), { cwd: dir, detached: true, stdio: 'ignore', env });
    child.on('error', (e) => log.warn('headless session failed to start', dir, e.message));
    child.on('exit', () => this.headless.delete(id));
    child.unref();
    this.headless.set(id, child);
    audit('session.start', { dir, task, headless: id, pid: child.pid });
    return id;
  }

  /** Stop a headless session this hub started (its whole process group). */
  private stopHeadless(sessionId: string): boolean {
    const child = this.headless.get(sessionId);
    if (!child?.pid || child.exitCode !== null) return false;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      return false;
    }
    this.headless.delete(sessionId);
    return true;
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
