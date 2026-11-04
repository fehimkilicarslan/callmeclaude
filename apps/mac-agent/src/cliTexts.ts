/**
 * User-facing `cmc` texts that differ per operating system. Kept free of side effects so tests can pin
 * them: the macOS texts must stay byte-for-byte unchanged.
 */

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
