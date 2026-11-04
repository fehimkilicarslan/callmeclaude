import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of bin/cmc.mjs (the service entry point). */
export const binPath = () => resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'cmc.mjs');

/** launchd label and systemd unit base name. */
export const SERVICE_LABEL = 'dev.callmeclaude.hub';

/** Security patterns shared by every platform. */
/**
 * A dotenv file anywhere in a tool input. The guard tests JSON.stringify(input), so the name is usually
 * followed by a quote (`{"file_path":"/p/.env"}`, `{"command":"cat .env"}`). Matches .env and .env.local /
 * .env.production…, but not .envrc, .environment or the harmless .env.example / .sample / .template / .dist.
 */
export const DOTENV = /(?:^|[\s"'`=\/:<>(\\])\.env(?!\.(?:example|sample|template|dist)\b)(?:\.[\w-]+)*(?=$|[\s"'`\/;|&)<>,\\])/;

export const COMMON_PROTECTED = [/\.ssh\//, /\.aws\/credentials/, /\.gnupg\//, DOTENV, /\.claude\/\.credentials/];
