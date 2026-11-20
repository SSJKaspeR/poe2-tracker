#!/usr/bin/env node
// Builds the calculation engine shipped with the app ("engine pack"):
//
//   build/engine/
//     engine.json        versions used
//     bin/               luajit(.exe) [+ lua51.dll, zlib1.dll, MSVC runtime on Windows]
//     clibs/             lua-utf8 native module
//     pob/               Path of Building (PoE 2), unmodified, without images:
//                        src/ (Lua code + data), runtime/lua/, LICENSE.md
//
// PoB is MIT-licensed; its LICENSE.md is shipped with it. Images (tree art,
// gem icons) are left out: the headless engine never reads them (≈ 340 MB saved).
//
// Usage: node scripts/build-engine-pack.mjs [--out build/engine]
// Windows: run from a "Developer Command Prompt" (MSVC), as the CI does.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const CACHE = join(ROOT, '.pob', 'cache')
const outArg = process.argv.indexOf('--out')
const OUT = resolve(outArg > 0 ? process.argv[outArg + 1] : join(ROOT, 'build', 'engine'))
const WIN = process.platform === 'win32'
const versions = JSON.parse(readFileSync(join(ROOT, 'engine.json'), 'utf8'))

const IMAGE = /\.(png|jpg|jpeg|dds|zst|webp)$/i

function run(cmd, args, cwd, shell = false) {
  console.log(`$ ${cmd} ${args.join(' ')}${cwd ? `   (in ${relative(ROOT, cwd) || '.'})` : ''}`)
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell })
}

function checkout(repo, ref, dir, { shallow }) {
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dirname(dir), { recursive: true })
    if (shallow) run('git', ['clone', '--depth', '1', '--branch', ref, repo, dir])
    else run('git', ['clone', repo, dir])
  }
  if (!shallow) run('git', ['checkout', '-q', ref], dir)
}

/** Copy a tree, skipping images. */
function copyFiltered(from, to) {
  cpSync(from, to, {
    recursive: true,
    filter: (src) => statSync(src).isDirectory() || !IMAGE.test(src)
  })
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'bin'), { recursive: true })
mkdirSync(join(OUT, 'clibs'), { recursive: true })

// 1. Path of Building, pinned release, without images.
const pobSrc = join(CACHE, `pob-${versions.pob.ref}`)
checkout(versions.pob.repo, versions.pob.ref, pobSrc, { shallow: true })
copyFiltered(join(pobSrc, 'src'), join(OUT, 'pob', 'src'))
cpSync(join(pobSrc, 'runtime', 'lua'), join(OUT, 'pob', 'runtime', 'lua'), { recursive: true })
// manifest.xml carries the PoB version shown in the app.
for (const f of ['LICENSE.md', 'LICENSE', 'manifest.xml']) {
  if (existsSync(join(pobSrc, f))) cpSync(join(pobSrc, f), join(OUT, 'pob', f))
}

// 2. LuaJIT at the commit PoB uses (supports `+=`).
const ljSrc = join(CACHE, `luajit-${versions.luajit.ref.slice(0, 12)}`)
checkout(versions.luajit.repo, versions.luajit.ref, ljSrc, { shallow: false })

if (WIN) {
  // Dynamic build: luajit.exe + lua51.dll. PoB's lua-utf8.dll links against lua51.dll.
  run('cmd', ['/c', 'msvcbuild.bat'], join(ljSrc, 'src'))
  for (const f of ['luajit.exe', 'lua51.dll']) cpSync(join(ljSrc, 'src', f), join(OUT, 'bin', f))
  // LuaJIT loads jit.* modules from <exe dir>/lua/jit (needed by -j options only; shipped for completeness).
  cpSync(join(ljSrc, 'src', 'jit'), join(OUT, 'bin', 'lua', 'jit'), { recursive: true })
  // Native pieces PoB already ships for Windows.
  const rt = join(pobSrc, 'runtime')
  cpSync(join(rt, 'lua-utf8.dll'), join(OUT, 'clibs', 'lua-utf8.dll'))
  for (const f of ['zlib1.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']) {
    if (existsSync(join(rt, f))) cpSync(join(rt, f), join(OUT, 'bin', f))
  }
} else {
  run('make', ['-j4', 'BUILDMODE=static'], ljSrc)
  cpSync(join(ljSrc, 'src', 'luajit'), join(OUT, 'bin', 'luajit'))
  // lua-utf8 from source.
  const utf8 = join(CACHE, 'luautf8')
  if (!existsSync(utf8)) run('git', ['clone', '--depth', '1', 'https://github.com/starwing/luautf8', utf8])
  const cc = process.platform === 'darwin' ? ['-bundle', '-undefined', 'dynamic_lookup'] : ['-shared', '-fPIC']
  run('cc', ['-O2', ...cc, `-I${join(ljSrc, 'src')}`, 'lutf8lib.c', '-o', join(OUT, 'clibs', 'lua-utf8.so')], utf8)
}

writeFileSync(
  join(OUT, 'engine.json'),
  JSON.stringify({ ...versions, platform: process.platform, arch: process.arch, builtAt: new Date().toISOString() }, null, 2)
)

const size = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (n, e) => n + (e.isDirectory() ? size(join(dir, e.name)) : statSync(join(dir, e.name)).size),
    0
  )
console.log(`\nEngine pack ready: ${relative(ROOT, OUT)} (${(size(OUT) / 1e6).toFixed(1)} MB)`)
