import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Locates PoE 2's Client.txt. The log lives in the game install folder under
 * `logs/`, not in Documents/My Games.
 */

const STANDALONE_CANDIDATES = [
  'C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile 2',
  'C:\\Program Files\\Grinding Gear Games\\Path of Exile 2',
  'C:\\Program Files\\Epic Games\\PathOfExile2',
  'C:\\Program Files (x86)\\Epic Games\\PathOfExile2'
]

const STEAM_ROOTS = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']

/** Parse Steam's libraryfolders.vdf and return every library path. */
export function parseSteamLibraries(vdf: string): string[] {
  const paths: string[] = []
  const re = /"path"\s+"([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(vdf))) paths.push(m[1]!.replace(/\\\\/g, '\\'))
  return paths
}

export function candidateClientLogPaths(): string[] {
  const installDirs: string[] = []
  for (const root of STEAM_ROOTS) {
    installDirs.push(join(root, 'steamapps', 'common', 'Path of Exile 2'))
    const vdf = join(root, 'steamapps', 'libraryfolders.vdf')
    if (existsSync(vdf)) {
      try {
        for (const lib of parseSteamLibraries(readFileSync(vdf, 'utf8'))) {
          installDirs.push(join(lib, 'steamapps', 'common', 'Path of Exile 2'))
        }
      } catch {
        // ignore unreadable Steam config
      }
    }
  }
  installDirs.push(...STANDALONE_CANDIDATES)
  return [...new Set(installDirs.map((d) => join(d, 'logs', 'Client.txt')))]
}

export function findClientLog(): string | null {
  return candidateClientLogPaths().find((p) => existsSync(p)) ?? null
}
