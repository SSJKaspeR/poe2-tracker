import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface PobPaths {
  luajitPath: string
  pobDir: string
  luaCPath: string[]
  /** Directories to put first in PATH (Windows: lua51.dll, zlib1.dll, MSVC runtime). */
  extraPath?: string[]
}

/**
 * Engine pack built by scripts/build-engine-pack.mjs (shipped in the installer
 * under resources/engine): bin/luajit, clibs/lua-utf8, pob/.
 */
export function resolveEnginePack(engineDir: string): PobPaths | null {
  const exe = process.platform === 'win32' ? 'luajit.exe' : 'luajit'
  const luajitPath = join(engineDir, 'bin', exe)
  const pobDir = join(engineDir, 'pob')
  if (!existsSync(luajitPath) || !existsSync(join(pobDir, 'src', 'HeadlessWrapper.lua'))) return null
  return { luajitPath, pobDir, luaCPath: [join(engineDir, 'clibs')], extraPath: [join(engineDir, 'bin')] }
}

/** Dev engine installed by `npm run setup:pob` under `<root>/.pob`. */
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

/**
 * Where the engine lives, in order: $POB_ENGINE_DIR, the packaged engine
 * (resources/engine), a locally built pack (build/engine), the dev setup (.pob).
 */
export function resolvePobPaths(opts: { root: string; resourcesPath?: string }): PobPaths | null {
  const candidates = [
    process.env.POB_ENGINE_DIR,
    opts.resourcesPath ? join(opts.resourcesPath, 'engine') : undefined,
    join(opts.root, 'build', 'engine')
  ].filter((d): d is string => Boolean(d))
  for (const dir of candidates) {
    const p = resolveEnginePack(dir)
    if (p) return p
  }
  return resolveDevPobPaths(opts.root)
}
