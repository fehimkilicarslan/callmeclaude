import { COMMON_PROTECTED } from './common.ts';
import { darwin } from './darwin.ts';
import { linux } from './linux.ts';
import type { Platform } from './types.ts';

export type { DoctorCheck, Platform } from './types.ts';
export { SecretStoreError } from './types.ts';

export function selectPlatform(os: NodeJS.Platform = process.platform): Platform {
  if (os === 'darwin') return darwin;
  if (os === 'linux') return linux;
  throw new Error(`CallMeClaude hub supports macOS and Linux, not ${os}.`);
}

export const platform = selectPlatform();

/** Brain tool-guard patterns: shared ones plus the platform's own. */
export function securityPatterns(p: Platform = platform) {
  return {
    PROTECTED: [...COMMON_PROTECTED, ...p.security.protectedPaths],
    DESTRUCTIVE: new RegExp(`(${p.security.destructive.join('|')})`, 'i'),
  };
}
