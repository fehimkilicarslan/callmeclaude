/**
 * Linux computer use: which tools can look at and drive this desktop.
 * Detection and driver selection are pure (environment + "is this binary on PATH?" in, driver out)
 * so the whole matrix is testable without a display.
 */

export type SessionKind = 'x11' | 'wayland' | 'none';
export type DesktopFamily = 'gnome' | 'kde' | 'wlroots' | 'other';

export interface ComputerEnv {
  session: SessionKind;
  desktop: DesktopFamily;
  /** XDG_CURRENT_DESKTOP as given (or a compositor hint), for messages. */
  desktopName: string;
  display?: string;
  /** XDG_SESSION_TYPE as given (lowercase), for messages. */
  sessionType: string;
}

export type ScreenshotTool = 'scrot' | 'import' | 'maim' | 'spectacle' | 'grim';
export type InputTool = 'xdotool' | 'ydotool';

export interface ComputerDriver {
  env: ComputerEnv;
  /** 'x11', 'wayland-kde', 'wayland-wlroots', 'wayland-gnome', 'wayland-other' or 'none'. */
  id: string;
  screenshot: ScreenshotTool | null;
  input: InputTool | null;
  /** Desktop control is offered only with a screenshot tool: the agent must be able to verify what it did. */
  desktop: boolean;
  /** Tools that would make this environment work (first = recommended), with what they are for. */
  missing: { tool: string; purpose: 'screenshot' | 'input' }[];
  /** Why something is not supported here (shown by doctor and told to the agent). */
  notes: string[];
}

type Env = Record<string, string | undefined>;

const WLROOTS = ['sway', 'hyprland', 'river', 'wayfire', 'labwc', 'niri', 'dwl', 'qtile', 'cage'];

/** Which session and desktop is this? Pure: reads only the given environment. */
export function detectComputerEnv(env: Env): ComputerEnv {
  const type = (env.XDG_SESSION_TYPE ?? '').toLowerCase();
  const hasW = !!env.WAYLAND_DISPLAY;
  const hasX = !!env.DISPLAY;
  // XDG_SESSION_TYPE wins when it names a graphical session. A Wayland session that also has DISPLAY (XWayland)
  // is Wayland: xdotool would only reach XWayland windows. Without it (ssh, tty, CI) the display variables decide.
  let session: SessionKind;
  if (type === 'wayland') session = hasW ? 'wayland' : 'none';
  else if (type === 'x11') session = hasX ? 'x11' : 'none';
  else session = hasW ? 'wayland' : hasX ? 'x11' : 'none';
  let desktopName = env.XDG_CURRENT_DESKTOP || env.XDG_SESSION_DESKTOP || env.DESKTOP_SESSION || '';
  const parts = desktopName.toLowerCase().split(':');
  let desktop: DesktopFamily = 'other';
  if (parts.includes('gnome')) desktop = 'gnome';
  else if (parts.includes('kde')) desktop = 'kde';
  else if (parts.some((p) => WLROOTS.includes(p))) desktop = 'wlroots';
  else if (env.SWAYSOCK || env.HYPRLAND_INSTANCE_SIGNATURE) {
    desktop = 'wlroots';
    desktopName ||= env.SWAYSOCK ? 'sway' : 'Hyprland';
  }
  return { session, desktop, desktopName, sessionType: type, display: session === 'wayland' ? env.WAYLAND_DISPLAY : session === 'x11' ? env.DISPLAY : undefined };
}

// ---------- desktop session environment ----------

/** What the computer task needs to reach the desktop; a hub started before the desktop login (linger) lacks them. */
export const SESSION_VARS = ['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP', 'DBUS_SESSION_BUS_ADDRESS'] as const;
const GRAPHICAL_VARS = SESSION_VARS.filter((v) => v !== 'DBUS_SESSION_BUS_ADDRESS');

/**
 * The environment a computer task runs with (pure). When the hub's own environment shows no display, the
 * graphical variables come from the systemd user manager (`systemctl --user show-environment`, which the
 * desktop fills at login) as one set, so a stale XDG_SESSION_TYPE=tty cannot mix with a Wayland display.
 * DBUS_SESSION_BUS_ADDRESS is filled on its own when missing. Variables the hub already has are kept.
 * Returns the merged environment and the values taken from systemd (given to the agent process; the hub's
 * own environment is never changed).
 */
export function desktopSessionEnv(proc: Env, systemd: Env): { env: Env; fromSystemd: Record<string, string> } {
  const fromSystemd: Record<string, string> = {};
  if (!proc.DISPLAY && !proc.WAYLAND_DISPLAY && (systemd.DISPLAY || systemd.WAYLAND_DISPLAY)) {
    for (const v of GRAPHICAL_VARS) if (systemd[v]) fromSystemd[v] = systemd[v]!;
  }
  if (!proc.DBUS_SESSION_BUS_ADDRESS && systemd.DBUS_SESSION_BUS_ADDRESS) fromSystemd.DBUS_SESSION_BUS_ADDRESS = systemd.DBUS_SESSION_BUS_ADDRESS;
  return { env: { ...proc, ...fromSystemd }, fromSystemd };
}

/** True when this environment lacks something the computer task may need (then systemd is asked). */
export const needsSessionEnv = (proc: Env) => (!proc.DISPLAY && !proc.WAYLAND_DISPLAY) || !proc.DBUS_SESSION_BUS_ADDRESS;

const X11_SHOTS: ScreenshotTool[] = ['scrot', 'import', 'maim'];

/** Pick the computer-use driver for an environment. Pure: `has(bin)` answers "is it on PATH?". */
export function selectComputerDriver(envVars: Env, has: (bin: string) => boolean): ComputerDriver {
  const env = detectComputerEnv(envVars);
  const missing: ComputerDriver['missing'] = [];
  const notes: string[] = [];
  let screenshot: ScreenshotTool | null = null;
  let input: InputTool | null = null;
  let id: string;

  const want = (tool: string, purpose: 'screenshot' | 'input') => {
    if (has(tool)) return true;
    missing.push({ tool, purpose });
    return false;
  };

  if (env.session === 'none') {
    id = 'none';
    const v = env.sessionType === 'wayland' ? 'WAYLAND_DISPLAY' : env.sessionType === 'x11' ? 'DISPLAY' : '';
    notes.push(
      v
        ? `XDG_SESSION_TYPE=${env.sessionType} but ${v} is not set for the hub, so it cannot reach the desktop.`
        : 'No graphical session: neither DISPLAY nor WAYLAND_DISPLAY is set for the hub.',
    );
  } else if (env.session === 'x11') {
    id = 'x11';
    screenshot = X11_SHOTS.find(has) ?? null;
    if (!screenshot) missing.push({ tool: 'scrot', purpose: 'screenshot' });
    if (want('xdotool', 'input')) input = 'xdotool';
  } else {
    id = `wayland-${env.desktop}`;
    if (env.desktop === 'kde') {
      if (want('spectacle', 'screenshot')) screenshot = 'spectacle';
    } else if (env.desktop === 'wlroots') {
      if (want('grim', 'screenshot')) screenshot = 'grim';
    } else if (env.desktop === 'gnome') {
      notes.push(
        'GNOME on Wayland has no unattended screenshot path: GNOME Shell only lets its own components call the Screenshot D-Bus API, and the screenshot portal asks the person at the screen. Screenshots are not supported here.',
      );
    } else {
      notes.push(`No known screenshot tool for the "${env.desktopName || 'unknown'}" Wayland desktop.`);
    }
    if (want('ydotool', 'input')) input = 'ydotool';
  }

  const desktop = !!screenshot;
  if (!desktop && env.session !== 'none') notes.push('Desktop control needs a screenshot tool, so only the browser tools can be used.');
  return { env, id, screenshot, input, desktop, missing, notes };
}

/** Screenshot command for a file path (all non-interactive, whole screen). */
export function screenshotCommand(tool: ScreenshotTool, file: string) {
  const f = shq(file);
  switch (tool) {
    case 'scrot':
      return `scrot --pointer ${f}`;
    case 'import':
      return `import -window root ${f}`;
    case 'maim':
      return `maim ${f}`;
    case 'spectacle':
      return `spectacle --background --nonotify --fullscreen --output ${f}`;
    case 'grim':
      return `grim -c ${f}`;
  }
}

const shq = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export function envSummary(env: ComputerEnv) {
  if (env.session === 'none') return 'no graphical session';
  const s = env.session === 'x11' ? 'X11' : 'Wayland';
  return `${s}${env.desktopName ? `, ${env.desktopName}` : ''}${env.display ? ` (${env.session === 'x11' ? 'DISPLAY' : 'WAYLAND_DISPLAY'}=${env.display})` : ''}`;
}

/**
 * The "Tools" block of the computer-task system prompt on Linux (the Rules block is shared with macOS).
 * `shotDir` is a private temporary directory the hub creates per task and removes afterwards.
 */
export function linuxToolsBlock(d: ComputerDriver, o: { shotDir: string; browser: boolean }): string {
  const L: string[] = [];
  L.push(`This computer runs Linux: ${envSummary(d.env)}. Desktop driver: ${d.id}.`);
  L.push('Tools (prefer them in this order):');
  if (o.browser) {
    L.push(
      '- For a web page use the Claude in Chrome tools (mcp__claude-in-chrome__*) if they are available: find the tab, read the page, click, fill forms. They work the same on every desktop.',
    );
  }
  if (!d.desktop) {
    L.push(`- Desktop control is NOT supported in this environment: ${d.notes.join(' ')}`);
    L.push(
      o.browser
        ? '- Use only the browser tools. If the task needs the desktop or a native app, stop and say that this is not supported on this computer.'
        : '- Nothing can operate this desktop: say that this is not supported on this computer.',
    );
    return L.join('\n');
  }
  const shot = (n: number) => screenshotCommand(d.screenshot!, `${o.shotDir}/${n}.png`);
  L.push(`- For the desktop and apps use Bash with the commands below. There is no Peekaboo, cliclick, screencapture or osascript on Linux.`);
  L.push('Screen:');
  L.push(
    `- Screenshot into a NEW numbered file in ${o.shotDir}: \`${shot(1)}\`, next time ${o.shotDir}/2.png and so on. Look at it with the Read tool, then delete it right away: \`rm -f ${o.shotDir}/1.png\`. Never copy screenshots anywhere else.`,
  );
  if (d.input === 'xdotool') {
    L.push(
      '- Coordinates: screenshot pixels ARE X11 screen coordinates; use the position you see in the image directly with xdotool. With several monitors the screenshot is the whole X screen (all monitors side by side) and the same coordinates apply. X11 does not scale per monitor, so there is nothing to convert.',
    );
    L.push('Mouse and keyboard (xdotool):');
    L.push('- Move and click: `xdotool mousemove X Y click 1` (button 3 = right, `click --repeat 2 1` = double click). Check the pointer with `xdotool getmouselocation`.');
    L.push("- Type: `xdotool type --delay 40 -- 'text'`. Keys: `xdotool key Return`, `xdotool key ctrl+l`, `xdotool key alt+Tab`.");
    L.push("- Windows: `xdotool getactivewindow getwindowname`; bring one forward with `xdotool search --onlyvisible --name 'Firefox' windowactivate --sync`.");
  } else if (d.input === 'ydotool') {
    L.push(
      '- Coordinates: the screenshot covers all monitors in physical pixels. ydotool moves the pointer through a virtual input device, so with display scaling (e.g. 150%: divide by 1.5) or pointer acceleration it may land somewhere else, and with several monitors the mapping is unverified. After every pointer move take a screenshot, check where the pointer is and correct BEFORE clicking. Prefer the keyboard (shortcuts, Tab, typing) over the pointer.',
    );
    L.push('Mouse and keyboard (ydotool 1.x, needs the ydotoold daemon):');
    L.push('- Move: `ydotool mousemove --absolute -x X -y Y`. Left click: `ydotool click 0xC0`, right click: `ydotool click 0xC1`.');
    L.push(
      "- Type: `ydotool type -- 'text'`. Keys are Linux key codes, code:1 = press, code:0 = release: Enter `ydotool key 28:1 28:0`, ctrl+L `ydotool key 29:1 38:1 38:0 29:0` (Ctrl 29, Alt 56, Shift 42, Super 125, Tab 15, Esc 1).",
    );
    L.push('- If ydotool says it cannot connect to its socket, ydotoold is not running: say so and stop. Do not try to start it or change permissions.');
  } else {
    L.push('- No input tool is available (no mouse or keyboard control): you can only look. Report what you see and say that clicking and typing are not supported on this computer.');
  }
  return L.join('\n');
}

/** Extra rules on Linux; the shared Rules block stays as it is on macOS. */
export const LINUX_EXTRA_RULES = [
  '- Every Bash command still goes through the CallMeClaude safety policy: protected paths and destructive commands are blocked. If something is blocked, do not work around it; report it.',
];

// ---------- ydotool version ----------

/**
 * The prompt and the doctor steps use the ydotool 1.x command line (`mousemove --absolute -x -y`, `click 0xC0`,
 * key codes, the ydotoold socket). 0.1.x (e.g. Ubuntu 22.04) has a different syntax, so it is ignored.
 */
export interface YdotoolVersion {
  /** "1.0.4", or undefined when only the command signature was recognised. */
  version?: string;
  major?: number;
  /** true only for 1.x. */
  supported: boolean;
}

/**
 * ydotool's version from what the hub could read (pure). `pkg` is the package manager's answer
 * (`pacman -Q ydotool` → "ydotool 1:1.0.4-2", `dpkg-query -W -f '${Version}' ydotool` → "0.1.8-3",
 * `rpm -q --qf '%{VERSION}' ydotool` → "1.0.4"); `cli` is the output of `ydotool --version` and `ydotool --help`.
 * The package version wins; then a version number in the CLI output; then the command list
 * (1.x lists "bakers" and mentions YDOTOOL_SOCKET; 0.1.x has "recorder" / "getmouselocation").
 */
export function ydotoolVersion(o: { pkg?: string; cli?: string }): YdotoolVersion {
  const fromPkg = o.pkg?.trim().split(/\s+/).pop()?.replace(/^\d+:/, '');
  const num = (s?: string) => s?.match(/(?:^|[^\w.])v?(\d+)\.(\d+)(?:\.(\d+))?/);
  const m = (fromPkg && /^\d/.test(fromPkg) ? num(fromPkg) : undefined) ?? num(o.cli);
  if (m) {
    const major = Number(m[1]);
    return { version: [m[1], m[2], m[3]].filter((x) => x !== undefined).join('.'), major, supported: major === 1 };
  }
  const cli = o.cli ?? '';
  if (/\bbakers\b|YDOTOOL_SOCKET/.test(cli)) return { major: 1, supported: true };
  if (/\brecorder\b|\bgetmouselocation\b|mousemove_relative/.test(cli)) return { major: 0, supported: false };
  return { supported: false };
}

export const YDOTOOL_REQUIRED = 'ydotool 1.x required';

/** Doctor text for an installed ydotool that is not 1.x. */
export function ydotoolTooOld(v: YdotoolVersion) {
  return `${YDOTOOL_REQUIRED} (found ${v.version ? `ydotool ${v.version}` : 'a ydotool whose version could not be read'}); it is ignored. Install ydotool 1.x: a newer distribution package, or build it from https://github.com/ReimuNotMoe/ydotool`;
}

// ---------- install hints (doctor) ----------

export type PackageManager = 'apt' | 'dnf' | 'pacman';

/** Package manager from /etc/os-release text (ID, then ID_LIKE). Pure. */
export function packageManager(osRelease: string): PackageManager | undefined {
  const get = (k: string) => osRelease.match(new RegExp(`^${k}=["']?([^"'\\n]*)`, 'm'))?.[1]?.toLowerCase() ?? '';
  const ids = [get('ID'), ...get('ID_LIKE').split(/\s+/)].filter(Boolean);
  for (const id of ids) {
    if (['debian', 'ubuntu', 'linuxmint', 'pop', 'raspbian'].includes(id)) return 'apt';
    if (['fedora', 'rhel', 'centos', 'rocky', 'almalinux'].includes(id)) return 'dnf';
    if (['arch', 'manjaro', 'endeavouros', 'cachyos'].includes(id)) return 'pacman';
  }
  return undefined;
}

const PACKAGE: Record<string, Partial<Record<PackageManager, string>>> = {
  spectacle: { apt: 'kde-spectacle', dnf: 'spectacle', pacman: 'spectacle' },
  import: { apt: 'imagemagick', dnf: 'ImageMagick', pacman: 'imagemagick' },
};

export function installCommand(pm: PackageManager | undefined, tools: string[]) {
  const pkgs = tools.map((t) => (pm && PACKAGE[t]?.[pm]) || t);
  if (pm === 'apt') return `sudo apt install ${pkgs.join(' ')}`;
  if (pm === 'dnf') return `sudo dnf install ${pkgs.join(' ')}`;
  if (pm === 'pacman') return `sudo pacman -S ${pkgs.join(' ')}`;
  return `install with your package manager: ${pkgs.join(' ')}`;
}

export const UINPUT_RISK = 'Security cost: once this is allowed, every program running under your user account can create synthetic keyboard and mouse input.';

/**
 * One-time, optional, run by the user: ydotool and its access to /dev/uinput via a dedicated group
 * (not "input", which could also read keyboards). Only the steps that are still missing.
 */
export function uinputSteps(
  pm: PackageManager | undefined,
  user: string,
  o: { installed: boolean; uinput: boolean; daemon: boolean; userUnit: boolean; tooOld?: YdotoolVersion },
) {
  const steps: string[] = [];
  if (o.tooOld) steps.push(ydotoolTooOld(o.tooOld));
  else if (!o.installed) steps.push(installCommand(pm, ['ydotool']));
  if (!o.uinput) {
    steps.push(
      `sudo groupadd -f uinput && sudo usermod -aG uinput ${user}`,
      `echo 'KERNEL=="uinput", GROUP="uinput", MODE="0660", OPTIONS+="static_node=uinput"' | sudo tee /etc/udev/rules.d/60-callmeclaude-uinput.rules`,
      'echo uinput | sudo tee /etc/modules-load.d/uinput.conf && sudo modprobe uinput',
      'sudo udevadm control --reload-rules && sudo udevadm trigger --name-match=uinput',
      'log out and back in (new group)',
    );
  }
  if (!o.daemon) {
    steps.push(
      o.userUnit
        ? 'systemctl --user enable --now ydotool'
        : "start ydotoold in your session: if your package ships a systemd user unit, systemctl --user enable --now ydotool; otherwise add 'ydotoold' to your desktop's autostart",
    );
  }
  return steps;
}
