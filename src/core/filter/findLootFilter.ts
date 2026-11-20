import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'

/**
 * Finds the loot filter files of PoE 2. The game keeps local filters in
 * `Documents/My Games/Path of Exile 2` (next to its config .ini); filters followed
 * online (FilterBlade "Save & Sync", filter ladder) may be cached in `OnlineFilters`.
 *
 * ⚠️ To verify on a real install: the exact .ini name and how online filters are cached.
 * Hence the layered approach: the .ini's `item_filter=` line, else the files found,
 * else the player picks the file.
 */

export interface FilterCandidate {
  path: string
  name: string
  online: boolean
  modifiedAt: number
}

export function poe2DocumentsDirs(documents: string, home?: string): string[] {
  const dirs = [join(documents, 'My Games', 'Path of Exile 2')]
  if (home) dirs.push(join(home, 'OneDrive', 'Documents', 'My Games', 'Path of Exile 2'), join(home, 'OneDrive', 'Documents', 'Mes jeux', 'Path of Exile 2'))
  return [...new Set(dirs)].filter((d) => existsSync(d))
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** Display name: "#name:" header of online filters, else the file name. */
function filterName(path: string, online: boolean): string {
  if (online) {
    try {
      const head = readFileSync(path, 'utf8').slice(0, 2000)
      const m = /^#\s*name\s*[:=]\s*(.+)$/im.exec(head)
      if (m) return `${m[1]!.trim()} (online)`
    } catch {
      // fall through
    }
    return `${basename(path)} (online)`
  }
  return basename(path).replace(/\.filter$/i, '')
}

export function listFilters(dirs: string[]): FilterCandidate[] {
  const out: FilterCandidate[] = []
  for (const dir of dirs) {
    for (const f of safeList(dir)) {
      if (!/\.filter$/i.test(f)) continue
      const path = join(dir, f)
      out.push({ path, name: filterName(path, false), online: false, modifiedAt: mtime(path) })
    }
    const online = join(dir, 'OnlineFilters')
    for (const f of safeList(online)) {
      const path = join(online, f)
      if (!isFile(path)) continue
      out.push({ path, name: filterName(path, true), online: true, modifiedAt: mtime(path) })
    }
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

/** Filter selected in game, from `item_filter=` in the config .ini, if it resolves to a file. */
export function activeFilterFromConfig(dirs: string[]): string | null {
  for (const dir of dirs) {
    for (const f of safeList(dir)) {
      if (!/config.*\.ini$/i.test(f)) continue
      let text = ''
      try {
        text = readFileSync(join(dir, f), 'utf8')
      } catch {
        continue
      }
      const m = /^\s*item_filter\s*=\s*(.+?)\s*$/m.exec(text)
      if (!m || !m[1]) continue
      const value = m[1]
      const tries = isAbsolute(value)
        ? [value]
        : [join(dir, value), join(dir, `${value}.filter`), join(dir, 'OnlineFilters', value)]
      const hit = tries.find(isFile)
      if (hit) return hit
    }
  }
  return null
}

/** Best guess: the in-game selection, else the only (or most recently changed) filter. */
export function guessActiveFilter(dirs: string[]): string | null {
  return activeFilterFromConfig(dirs) ?? listFilters(dirs)[0]?.path ?? null
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function mtime(p: string): number {
  try {
    return statSync(p).mtimeMs
  } catch {
    return 0
  }
}
