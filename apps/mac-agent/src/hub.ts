import { AppServer } from './appServer.ts';
import { Calls } from './calls.ts';
import { loadConfig, saveConfig, type Config, type Mode } from './config.ts';
import { Controller } from './controller.ts';
import { startHookServer } from './hookServer.ts';
import { HUB_VERSION, State } from './state.ts';
import { audit, execFileP, log } from './util.ts';
import { VoiceCall, type CallSink } from './voice/call.ts';

class VoiceManager {
  active?: VoiceCall;
  constructor(private hub: Hub) {}

  async start(callId: string, direction: 'inbound' | 'outbound', sink: CallSink) {
    // Same call again (phone reconnected / duplicate start): re-attach, do not restart the conversation.
    if (this.active && this.active.callId === callId) {
      this.active.attach(sink);
      sink.json({ type: 'call.ready', callId });
      return;
    }
    if (this.active) this.active.end('replaced');
    const agenda = this.hub.calls.takeAgenda(direction === 'outbound' ? callId : undefined);
    const call = new VoiceCall(this.hub, callId, agenda.length ? 'outbound' : direction, agenda, sink, (reason) => {
      if (this.active === call) this.active = undefined;
      log.info('call ended', callId, reason);
    });
    this.active = call;
    audit('call.start', { callId, direction, agenda: agenda.length });
    try {
      await call.start();
    } catch (e) {
      this.active = undefined;
      sink.json({ type: 'error', message: (e as Error).message });
      sink.json({ type: 'call.ended', callId, reason: 'voice-error' });
      throw e;
    }
  }
}

export class Hub {
  cfg: Config;
  st: State;
  controller: Controller;
  calls: Calls;
  voice: VoiceManager;
  app: AppServer;

  constructor() {
    this.cfg = loadConfig();
    this.st = new State(this.cfg.mode);
    this.st.language = this.cfg.language;
    this.controller = new Controller(this.st, this.cfg);
    this.calls = new Calls(this);
    this.voice = new VoiceManager(this);
    this.app = new AppServer(this);
  }

  start() {
    startHookServer(this);
    this.app.start();
    setInterval(() => void this.detectStale(), 60_000);
    void this.detectStale();
    log.info(`CallMeClaude hub ${HUB_VERSION} started (mode=${this.cfg.mode})`);
    audit('hub.start', { version: HUB_VERSION });
    const bye = () => {
      this.st.save();
      process.exit(0);
    };
    process.on('SIGTERM', bye);
    process.on('SIGINT', bye);
  }

  setMode(m: Mode) {
    this.cfg.mode = m;
    this.st.mode = m;
    saveConfig(this.cfg);
    this.st.changed();
  }

  /** Sessions that look stuck: a tool started long ago and nothing happened since. */
  private async detectStale() {
    const now = Date.now();
    // Sessions whose tmux pane is gone have ended even if no SessionEnd hook arrived.
    let panes: Set<string> | undefined;
    try {
      const { stdout } = await execFileP('tmux', ['list-panes', '-a', '-F', '#{pane_id}']);
      panes = new Set(stdout.split('\n').filter(Boolean));
    } catch {
      panes = new Set(); // no tmux server → no panes
    }
    for (const s of this.st.activeSessions()) {
      if (s.tmuxPane && !panes.has(s.tmuxPane) && !this.st.holdForSession(s.id)) {
        s.state = 'ended';
        s.summary = 'Session closed.';
        this.st.changed();
        continue;
      }
      if (s.state !== 'running') continue;
      const idleMin = (now - Date.parse(s.updatedAt)) / 60000;
      if (idleMin > 20) {
        s.state = 'stale';
        s.summary = s.openTool ? `The ${s.openTool} tool has been running for ${Math.round(idleMin)} minutes.` : `No activity for ${Math.round(idleMin)} minutes.`;
        this.st.changed();
        if (!this.cfg.ignorePaths.some((p) => s.cwd === p || s.cwd.startsWith(p + '/')))
          this.calls.enqueue({ priority: 'P2', title: `${s.project}: silent`, text: `[${s.project}] ${s.summary} It may be stuck.` });
      }
      if (idleMin > 24 * 60) {
        s.state = 'ended';
        this.st.changed();
      }
    }
  }
}
