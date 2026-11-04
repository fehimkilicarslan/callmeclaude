import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { BRAIN_DIR } from './config.ts';
import { log } from './util.ts';

/**
 * All Claude access goes through the developer's own local Claude Code login
 * (Agent SDK spawns the bundled Claude Code). We never touch OAuth tokens.
 * settingSources: [] keeps the brain isolated from user hooks (no recursion
 * into our own hook server) and from project settings.
 */
const base = (): Options => ({
  cwd: BRAIN_DIR,
  settingSources: [],
  persistSession: false,
  env: { ...process.env, CMC_INTERNAL: '1' } as Record<string, string>,
});

export async function oneShot(prompt: string, opts: { model: string; system: string; timeoutMs?: number }) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? 45_000);
  try {
    let result = '';
    for await (const m of query({
      prompt,
      options: { ...base(), model: opts.model, systemPrompt: opts.system, tools: [], maxTurns: 1, abortController: ac },
    })) {
      if (m.type === 'result') {
        if (m.subtype === 'success') result = m.result;
        else throw new Error(`claude result: ${m.subtype}`);
      }
    }
    return result.trim();
  } finally {
    clearTimeout(t);
  }
}

export interface AgentRun {
  task: string;
  model: string;
  system: string;
  maxTurns?: number;
  timeoutMs?: number;
  tools?: Options['tools'];
  mcpServers?: Options['mcpServers'];
  extraArgs?: Options['extraArgs'];
  cwd?: string;
  canUseTool?: Options['canUseTool'];
  /** Extra environment for the agent process (merged over the hub's own; the hub's process.env is not changed). */
  env?: Record<string, string>;
  onText?: (t: string) => void;
}

/** Multi-turn agent run (computer use, questions over transcripts). Returns the final text. */
export async function runAgent(r: AgentRun): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), r.timeoutMs ?? 10 * 60_000);
  try {
    let result = '';
    for await (const m of query({
      prompt: r.task,
      options: {
        ...base(),
        ...(r.env ? { env: { ...base().env, ...r.env } } : {}),
        cwd: r.cwd ?? BRAIN_DIR,
        model: r.model,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: r.system },
        tools: r.tools ?? { type: 'preset', preset: 'claude_code' },
        mcpServers: r.mcpServers,
        extraArgs: r.extraArgs,
        maxTurns: r.maxTurns ?? 40,
        permissionMode: 'default',
        canUseTool: r.canUseTool,
        abortController: ac,
        stderr: (d) => log.debug('[agent]', d.trim()),
      },
    })) {
      if (m.type === 'assistant') {
        for (const b of (m as any).message?.content ?? []) if (b.type === 'text' && b.text) r.onText?.(b.text);
      }
      if (m.type === 'result') {
        result = m.subtype === 'success' ? m.result : `The task could not be completed (${m.subtype}).`;
      }
    }
    return result.trim();
  } finally {
    clearTimeout(t);
  }
}

/** Extract the first JSON object in a model reply. */
export function parseJsonLoose<T>(s: string): T | undefined {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return;
  }
}
