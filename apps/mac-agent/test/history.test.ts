import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CMC_HOME ??= mkdtempSync(join(tmpdir(), 'cmc-history-'));
const { recentActivity } = await import('../src/brain.ts');

test('the brain sees earlier calls and computer tasks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmc-audit-'));
  const ev = (o: object) => JSON.stringify({ ts: '2026-11-05T08:22:00.000Z', ...o });
  writeFileSync(
    join(dir, '2026-11-05.jsonl'),
    [
      ev({ kind: 'call.end', reason: 'assistant-ended', transcript: [{ role: 'user', text: "Open WhatsApp, do Cem Çaça's request in the cem folder" }] }),
      ev({ kind: 'computer.done', task: "Find Cem Çaça's chat", result: 'Last message: again A5 size' }),
      'not json',
      ev({ kind: 'app.connect' }),
    ].join('\n'),
  );
  const h = recentActivity(dir);
  assert.match(h, /Phone call \(assistant-ended\)/);
  assert.match(h, /cem folder/);
  assert.match(h, /A5 size/);
  assert.doesNotMatch(h, /app\.connect/);
  assert.equal(recentActivity(join(dir, 'missing')), '(none)');
});
