import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface PobPaths {
  luajitPath: string
  pobDir: string
  luaCPath: string[]
}

/** Resolve the dev engine installed by `npm run setup:pob` under `<root>/.pob`. */
export function resolveDevPobPaths(root: string): PobPaths | null {
  const base = join(root, '.pob')
  const pobDir = join(base, 'PathOfBuilding-PoE2')
  const binDir = join(base, 'luajit', 'bin')
  if (!existsSync(pobDir) || !existsSync(binDir)) return null
  // `make install` creates a versioned binary plus a `luajit` symlink.
  const exe = process.platform === 'win32' ? 'luajit.exe' : 'luajit'
  let luajitPath = join(binDir, exe)
  if (!existsSync(luajitPath)) {
    const versioned = readdirSync(binDir).find((f) => f.startsWith('luajit-'))
    if (!versioned) return null
    luajitPath = join(binDir, versioned)
  }
  return { luajitPath, pobDir, luaCPath: [join(base, 'clibs')] }
}
