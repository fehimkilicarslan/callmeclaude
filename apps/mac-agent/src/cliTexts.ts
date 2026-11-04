/**
 * User-facing `cmc` texts that differ per operating system. Kept free of side effects so tests can pin
 * them: the macOS texts must stay byte-for-byte unchanged.
 */
import type { DoctorResult } from './platform/types.ts';

/** What `cmc pair` prints after the QR code. */
export function pairTexts(os: NodeJS.Platform) {
  if (os === 'linux') {
    return {
      scan: '\nIn the CallMeClaude app scan this QR code to pair the phone with this computer. To enter it manually:\n',
      noTailscale:
        '\n⚠️  Tailscale is not connected: to reach this computer on the road, log in to Tailscale on this computer and the phone, then run `cmc pair` again.',
    };
  }
  return {
    scan: '\nIn the CallMeClaude app tap "Pair Mac" and scan this QR code. To enter it manually:\n',
    noTailscale:
      '\n⚠️  Tailscale is not connected: to reach this Mac on the road, log in to Tailscale on the Mac and the phone, then run `cmc pair` again.',
  };
}

/** One `cmc doctor` line. `{ info }` is a note (ℹ️), not a problem; it is only used on Linux. */
export function doctorLine(name: string, r: DoctorResult): string {
  if (typeof r === 'object') return `ℹ️  ${name}: ${r.info}`;
  const good = r === true || (typeof r === 'string' && !r.startsWith('!'));
  return `${good ? '✅' : '❌'} ${name}${typeof r === 'string' ? ': ' + r.replace(/^!/, '') : ''}`;
}

/**
 * The doctor line about the iPhone's VoIP token (devices.json, written only when an iPhone registers one).
 * On Linux the phone may be an Android, which never registers a token, so a missing token is only a note.
 */
export function voipTokenTexts(os: NodeJS.Platform) {
  const linux = os === 'linux';
  const missing = (mac: string): DoctorResult =>
    linux ? { info: 'none: needed only to ring an iPhone in the background (the Android app does not use it)' } : mac;
  return {
    doctorName: linux ? 'iPhone registered (VoIP token)' : 'Phone registered (VoIP token)',
    /** `devices` = parsed devices.json, or undefined when the file does not exist. */
    result(devices: Record<string, { voipToken?: string }> | undefined): DoctorResult {
      if (!devices) return missing('!not paired yet');
      return Object.values(devices).some((x) => x.voipToken) ? Object.keys(devices).join(', ') : missing('!no token yet');
    },
  };
}
