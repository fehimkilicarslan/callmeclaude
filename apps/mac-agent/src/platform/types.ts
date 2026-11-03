/** Everything the hub does differently per operating system lives behind this interface. */

export type DoctorResult = boolean | string;
/** A doctor check: `true`/plain string = ok, `false`/string starting with "!" = problem (same convention as index.ts). */
export interface DoctorCheck {
  name: string;
  fn: () => Promise<DoctorResult>;
}

export interface SecretStore {
  /** Human-facing name, e.g. "Keychain". */
  displayName: string;
  /** Raw stored string, or undefined if missing/unreadable. */
  get(service: string, account: string): string | undefined;
  /** Store a raw string. Throws on failure (never falls back to plain-text files). */
  set(service: string, account: string, value: string): void;
  /** Delete; never throws. */
  delete(service: string, account: string): void;
}

export interface ServiceManager {
  /** Shown to the user, e.g. "launchd". */
  displayName: string;
  /** launchd label / systemd unit base name. */
  label: string;
  /** Path of the service definition file (plist / unit). */
  definitionPath: string;
  install(): Promise<void>;
  uninstall(): Promise<void>;
  restart(): Promise<void>;
}

export interface Platform {
  id: 'darwin' | 'linux';
  secrets: SecretStore;
  service: ServiceManager;
  /** OS-specific doctor checks, printed after the common ones (where Peekaboo/pmset used to be). */
  doctorChecks(): DoctorCheck[];
  /** Run a command line through the user's login shell. */
  shellExec(command: string, opts?: { timeout?: number }): Promise<{ stdout: string; stderr: string }>;
  /** PATH given to the background service. */
  servicePath(): string;
  /** Candidate `tailscale` binaries, tried in order. */
  tailscaleBins: string[];
  /** false for VPN/tunnel interfaces that must not be offered as LAN pairing addresses. */
  isLanInterface(name: string): boolean;
  /** Open a file with the desktop's default viewer (best effort). */
  openFile(path: string): void;
  /** OS-specific security patterns used by the brain's tool guard. */
  security: {
    protectedPaths: RegExp[];
    /** Alternatives joined into one case-insensitive DESTRUCTIVE regex. */
    destructive: string[];
  };
  /** Diagnostics returned by the hub's /control/permissions endpoint. */
  diagnostics(): Promise<Record<string, string>>;
}

/** Thrown by SecretStore.set when the OS secret store is unavailable; the message tells the user what to do. */
export class SecretStoreError extends Error {}
