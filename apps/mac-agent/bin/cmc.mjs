#!/usr/bin/env node
// CallMeClaude CLI / hub entry. Runs TypeScript sources through tsx.
import { register } from 'tsx/esm/api';
process.removeAllListeners('warning');
register();
await import('../src/index.ts');
