import { Behavior, type FunctionDeclaration } from '@google/genai';
import type { Hub } from '../hub.ts';
import { askBrain, computerTask } from '../brain.ts';
import { briefing } from './prompt.ts';
import { audit, clip, redact } from '../util.ts';
import { saveConfig, type Mode } from '../config.ts';

const str = (description: string) => ({ type: 'string', description });
const bool = (description: string) => ({ type: 'boolean', description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });

const CONFIRMED = bool('Did the developer EXPLICITLY confirm this action by voice? false if not.');

/** Long-running tools run asynchronously; the model keeps talking and the result arrives later. */
export const LONG_TOOLS = new Set(['computer_task', 'ask_brain']);

export const declarations: FunctionDeclaration[] = [
  { name: 'get_overview', description: 'Short, current summary of all Claude Code sessions and pending decisions.', parametersJsonSchema: obj({}) },
  { name: 'get_session', description: "One session's details and its last message.", parametersJsonSchema: obj({ project: str('Project name (approximate is fine)') }, ['project']) },
  {
    name: 'reply_to_session',
    description: "Pass the developer's instruction to a session (continue, do this, approved: submit it, etc.). Also resolves its pending question.",
    parametersJsonSchema: obj(
      { project: str('Project name'), instruction: str("Clear instruction for the session, capturing the developer's intent"), confirmed: CONFIRMED },
      ['project', 'instruction'],
    ),
  },
  {
    name: 'answer_permission',
    description: "Answer a session's permission request (run a command, edit a file, etc.).",
    parametersJsonSchema: obj(
      { project: str('Project name'), approve: bool('true = allow, false = deny'), note: str('Optional note for the agent when denying'), confirmed: CONFIRMED },
      ['project', 'approve'],
    ),
  },
  { name: 'release_session', description: 'Release a waiting session with no new instruction; it stops normally.', parametersJsonSchema: obj({ project: str('Project name') }, ['project']) },
  {
    name: 'start_session',
    description: 'Start a new Claude Code session in a project folder with a task.',
    parametersJsonSchema: obj({ project: str('Project / folder name'), task: str('Clear task description'), confirmed: CONFIRMED }, ['project', 'task']),
  },
  {
    name: 'computer_task',
    description: 'Let the hub itself operate the Mac: click in the browser, submit a form, use an app. Can take a while; the result arrives later.',
    parametersJsonSchema: obj({ task: str('Precise description of what to do'), project: str('Related project (optional)'), confirmed: CONFIRMED }, ['task']),
    behavior: Behavior.NON_BLOCKING,
  },
  {
    name: 'ask_brain',
    description: 'Answer a question by reading session transcripts and projects (what a session did, what the error was, which files changed). Can take a while.',
    parametersJsonSchema: obj({ question: str('The question') }, ['question']),
    behavior: Behavior.NON_BLOCKING,
  },
  { name: 'stop', description: 'Stop one session immediately, or all of them ("all" = panic).', parametersJsonSchema: obj({ target: str('Project name or "all"') }, ['target']) },
  { name: 'resume_hub', description: 'Re-enable automatic actions after a panic/pause.', parametersJsonSchema: obj({ confirmed: CONFIRMED }) },
  {
    name: 'set_mode',
    description: "Change when the hub may call: desk (I'm at the computer, no calls), away, ride (riding, extra short), sleep (emergencies only).",
    parametersJsonSchema: obj({ mode: { type: 'string', enum: ['desk', 'away', 'ride', 'sleep'] } }, ['mode']),
  },
  {
    name: 'set_language',
    description: 'Change the language you speak and write summaries in, from the next call on. Use a BCP-47 code such as en-US, tr-TR, de-DE, es-ES.',
    parametersJsonSchema: obj({ language: str('BCP-47 language code') }, ['language']),
  },
  {
    name: 'auto_approve',
    description: 'From now on, approve a specific permission in a project without asking (e.g. "npm test", "Edit").',
    parametersJsonSchema: obj({ project: str('Project name'), rule: str('Command prefix (e.g. "npm test") or tool name (e.g. "Edit")'), confirmed: CONFIRMED }, ['project', 'rule']),
  },
  { name: 'end_call', description: 'Hang up after saying goodbye.', parametersJsonSchema: obj({}) },
];

const HIGH_RISK =
  /(deploy|publish|push|pay|payment|purchase|buy|delete|drop|remove|send .*(mail|email|message)|production|prod\b|yayınla|ödeme|öde|satın|sil|gönder.*(mail|e-posta|mesaj))/i;
const needConfirm = (what: string) => ({ needs_confirmation: true, say: `Ask the developer for explicit confirmation first: ${what}` });

export async function runTool(hub: Hub, name: string, args: any, ctx: { endCall: () => void }): Promise<Record<string, unknown>> {
  audit('voice.tool', { name, args });
  const find = (p: string) => hub.st.findSession(p);
  const projects = () => hub.st.activeSessions().map((x) => x.project);
  switch (name) {
    case 'get_overview':
      return { overview: briefing(hub) };
    case 'get_session': {
      const s = find(args.project);
      if (!s) return { error: 'No open session with that name.', sessions: projects() };
      const p = hub.st.openPending().find((x) => x.sessionId === s.id);
      return { project: s.project, state: s.state, summary: s.summary, pending: p?.summary, last_message: redact(clip(s.lastMessage, 700)), last_instruction: clip(s.lastPrompt, 200) };
    }
    case 'reply_to_session': {
      const s = find(args.project);
      if (!s) return { error: 'Session not found.', sessions: projects() };
      const pend = hub.st.openPending().find((x) => x.sessionId === s.id);
      if ((HIGH_RISK.test(args.instruction) || pend?.risk === 'high' || pend?.risk === 'critical') && !args.confirmed) return needConfirm(args.instruction);
      const via = await hub.controller.instruct(s, args.instruction);
      const msg = {
        hold: 'Instruction delivered; the agent is continuing.',
        tmux: 'Instruction typed into the terminal.',
        resume: 'The session had ended; it was restarted with the instruction.',
        queue: 'The session is busy; the instruction will be delivered at the next opportunity.',
        none: 'Could not deliver the instruction.',
      }[via];
      return { ok: true, delivered_via: via, say: msg };
    }
    case 'answer_permission': {
      const s = find(args.project);
      if (!s) return { error: 'Session not found.' };
      const pend = hub.st.openPending().find((x) => x.sessionId === s.id && x.kind === 'permission');
      if (!pend) return { error: 'This session has no pending permission request.' };
      if (args.approve && (pend.risk === 'high' || pend.risk === 'critical') && !args.confirmed) return needConfirm(pend.summary);
      return { ok: hub.controller.permission(s, !!args.approve, args.note) };
    }
    case 'release_session': {
      const s = find(args.project);
      return { ok: s ? hub.controller.release(s) : false };
    }
    case 'start_session': {
      if (!args.confirmed) return needConfirm(`start a new session in ${args.project}: ${args.task}`);
      const dir = hub.controller.findProjectDir(args.project);
      if (!dir) return { error: 'Project folder not found.', roots: hub.cfg.projectRoots };
      const tmux = await hub.controller.startSession(dir, args.task);
      return { ok: true, dir, tmux, say: "Session started. I'll call when it's done or stuck." };
    }
    case 'computer_task': {
      if (!args.confirmed) return needConfirm(args.task);
      if (hub.st.paused) return { error: 'The hub is paused (panic). Call resume_hub first.' };
      return { result: await computerTask(hub, args.task, args.project) };
    }
    case 'ask_brain':
      return { answer: await askBrain(hub, args.question) };
    case 'stop': {
      if (String(args.target).toLowerCase() === 'all') {
        await hub.controller.panic();
        return { ok: true, say: 'All sessions stopped; automatic actions are paused.' };
      }
      const s = find(args.target);
      if (!s) return { error: 'Session not found.' };
      await hub.controller.interrupt(s);
      return { ok: true };
    }
    case 'resume_hub':
      if (!args.confirmed) return needConfirm('re-enable automatic actions');
      hub.st.paused = false;
      hub.st.changed();
      audit('resume', {});
      return { ok: true };
    case 'set_mode':
      hub.cfg.mode = args.mode as Mode;
      hub.st.mode = hub.cfg.mode;
      saveConfig(hub.cfg);
      hub.st.changed();
      return { ok: true, mode: args.mode };
    case 'set_language': {
      const code = String(args.language ?? '');
      if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)) return { error: 'Not a valid BCP-47 language code.' };
      hub.cfg.language = code;
      hub.st.language = code;
      saveConfig(hub.cfg);
      hub.st.changed();
      return { ok: true, language: code, say: 'Language changed; it applies fully from the next call.' };
    }
    case 'auto_approve': {
      if (!args.confirmed) return needConfirm(`stop asking for "${args.rule}" in ${args.project}`);
      const s = find(args.project);
      const project = s?.project ?? args.project;
      const rule = /^(Bash|Edit|Write|MultiEdit|Read|WebFetch|WebSearch|mcp__)/.test(args.rule) ? args.rule : `Bash(${args.rule}`;
      (hub.cfg.autoApprove[project] ??= []).push(rule);
      saveConfig(hub.cfg);
      return { ok: true, project, rule };
    }
    case 'end_call':
      ctx.endCall();
      return { ok: true };
    default:
      return { error: `unknown tool ${name}` };
  }
}
