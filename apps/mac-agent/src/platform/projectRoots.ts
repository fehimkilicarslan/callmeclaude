/**
 * Default project roots per OS (folders under $HOME; only the ones that exist end up in the config).
 * Kept free of imports so config.ts can use it without pulling in the platform layer.
 * Voice-started sessions may only run inside a project root (controller.ts).
 */
const MAC = ['Desktop/Projeler', 'Projects', 'Projeler', 'code', 'dev', 'src', 'Developer'];

/** Linux file systems are case-sensitive and ~/projects, ~/Desktop/projects are common there. */
const LINUX_EXTRA = ['projects', 'Desktop/projects', 'Desktop/Projects', 'Documents/projects', 'Documents/Projects', 'workspace', 'repos', 'git'];

export function projectRootCandidates(os: NodeJS.Platform = process.platform): string[] {
  return os === 'linux' ? [...MAC, ...LINUX_EXTRA] : MAC;
}
