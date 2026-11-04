import { connect } from 'node:http2';
import { createPrivateKey, sign } from 'node:crypto';
import type { Config } from './config.ts';
import type { DoctorResult } from './platform/types.ts';
import { getSecret } from './secrets.ts';
import { log } from './util.ts';

let cachedJwt: { token: string; at: number } | undefined;

function jwt(cfg: Config['apns'], p8: string) {
  if (cachedJwt && Date.now() - cachedJwt.at < 40 * 60_000) return cachedJwt.token;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'ES256', kid: cfg.keyId });
  const claims = b64({ iss: cfg.teamId, iat: Math.floor(Date.now() / 1000) });
  const sig = sign('sha256', Buffer.from(`${head}.${claims}`), { key: createPrivateKey(p8), dsaEncoding: 'ieee-p1363' });
  const token = `${head}.${claims}.${sig.toString('base64url')}`;
  cachedJwt = { token, at: Date.now() };
  return token;
}

const APNS_FLAGS = 'cmc setup --apns-key-file AuthKey_XXX.p8 --apns-key-id XXX --team-id XXX --bundle-id XXX';

/**
 * What setup and doctor say about APNs. APNs only wakes the iPhone app; the Android app keeps its own
 * connection to the hub and rings in the background without it. macOS texts are unchanged.
 */
export function apnsTexts(os: NodeJS.Platform): { setupMissing: string; doctorName: string; doctorMissing: DoctorResult } {
  if (os === 'linux') {
    return {
      setupMissing: `⚠️  APNs not configured (an iPhone rings only while the CallMeClaude app is open; the Android app is not affected, it rings in the background over its own connection): ${APNS_FLAGS}`,
      doctorName: 'APNs (hub can ring an iPhone in the background)',
      // Not a problem on Linux: only an iPhone needs APNs, so doctor shows a note instead of ❌.
      doctorMissing: { info: 'not configured (the Android app does not need it)' },
    };
  }
  return {
    setupMissing: `⚠️  APNs not configured (the hub can only ring the phone while the app is open): ${APNS_FLAGS}`,
    doctorName: 'APNs (hub can ring the phone)',
    doctorMissing: '!not configured',
  };
}

export function apnsConfigured(cfg: Config) {
  return !!(cfg.apns.teamId && cfg.apns.keyId && cfg.apns.bundleId && getSecret('apns-p8'));
}

/** Send a PushKit VoIP push straight to Apple. No relay server involved. */
export async function sendVoipPush(cfg: Config, deviceToken: string, payload: object): Promise<{ ok: boolean; status: number; reason?: string }> {
  const p8 = getSecret('apns-p8');
  if (!p8 || !cfg.apns.keyId || !cfg.apns.teamId) return { ok: false, status: 0, reason: 'APNs not configured' };
  const host = cfg.apns.environment === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
  return new Promise((resolve) => {
    const client = connect(host);
    client.on('error', (e) => {
      log.warn('apns connection error', e.message);
      resolve({ ok: false, status: 0, reason: e.message });
    });
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt(cfg.apns, p8)}`,
      'apns-topic': `${cfg.apns.bundleId}.voip`,
      'apns-push-type': 'voip',
      'apns-priority': '10',
      'apns-expiration': '0',
    });
    let status = 0;
    let body = '';
    req.on('response', (h) => (status = Number(h[':status'])));
    req.setEncoding('utf8');
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      client.close();
      let reason: string | undefined;
      try {
        reason = body ? JSON.parse(body).reason : undefined;
      } catch {}
      resolve({ ok: status === 200, status, reason });
    });
    req.end(JSON.stringify(payload));
  });
}
