import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of bin/cmc.mjs (the service entry point). */
export const binPath = () => resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'cmc.mjs');

/** launchd label and systemd unit base name. */
export const SERVICE_LABEL = 'dev.callmeclaude.hub';

/** Security patterns shared by every platform. */
export const COMMON_PROTECTED = [/\.ssh\//, /\.aws\/credentials/, /\.gnupg\//, /\/\.env(\.|$)/, /\.claude\/\.credentials/];
