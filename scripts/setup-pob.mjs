#!/usr/bin/env node
// Development setup for the headless Path of Building engine.
//
//   node scripts/setup-pob.mjs
//
// 1. Clones PathOfBuilding-PoE2 (unmodified, MIT) into .pob/PathOfBuilding-PoE2
// 2. Builds LuaJIT at the commit PoB pins (needs compound assignment `+=`)
// 3. Builds the lua-utf8 native module
//
// Linux/macOS only for now. Windows binaries will be produced by CI and shipped
// with the installer (see docs/pob-engine.md).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const POB_ROOT = join(ROOT, '.pob')
const POB_DIR = join(POB_ROOT, 'PathOfBuilding-PoE2')
const LUAJIT_SRC = join(POB_ROOT, 'luajit-src')
const LUAJIT_PREFIX = join(POB_ROOT, 'luajit')
const UTF8_SRC = join(POB_ROOT, 'luautf8')
const CLIBS = join(POB_ROOT, 'clibs')

// LuaJIT commit used by PoB's SimpleGraphic (vcpkg-ports/ports/luajit/2026-07-20_1).
const LUAJIT_REF = '2460b3ff93a1c955de3d62cfc825de7d68dc272e'
const POB_REPO = 'https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2'
const POB_REF = process.env.POB_REF ?? 'dev'

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { cwd, stdio: 'inherit' })
}

mkdirSync(POB_ROOT, { recursive: true })

if (!existsSync(POB_DIR)) {
  run('git', ['clone', '--depth', '1', '--branch', POB_REF, POB_REPO, POB_DIR])
} else {
  console.log('PathOfBuilding-PoE2 already present — `git -C .pob/PathOfBuilding-PoE2 pull` to update')
}

if (!existsSync(join(LUAJIT_PREFIX, 'bin'))) {
  if (!existsSync(LUAJIT_SRC)) run('git', ['clone', 'https://github.com/LuaJIT/LuaJIT', LUAJIT_SRC])
  run('git', ['checkout', '-q', LUAJIT_REF], LUAJIT_SRC)
  run('make', ['-j4'], LUAJIT_SRC)
  run('make', ['install', `PREFIX=${LUAJIT_PREFIX}`], LUAJIT_SRC)
}

mkdirSync(CLIBS, { recursive: true })
if (!existsSync(join(CLIBS, 'lua-utf8.so'))) {
  if (!existsSync(UTF8_SRC)) run('git', ['clone', '--depth', '1', 'https://github.com/starwing/luautf8', UTF8_SRC])
  run('gcc', [
    '-O2', '-shared', '-fPIC',
    `-I${join(LUAJIT_PREFIX, 'include', 'luajit-2.1')}`,
    'lutf8lib.c', '-o', 'lua-utf8.so'
  ], UTF8_SRC)
  copyFileSync(join(UTF8_SRC, 'lua-utf8.so'), join(CLIBS, 'lua-utf8.so'))
}

console.log('\nPoB engine ready:')
console.log(`  POB_DIR=${POB_DIR}`)
console.log(`  LUAJIT=${join(LUAJIT_PREFIX, 'bin', 'luajit')}`)
console.log(`  CLIBS=${CLIBS}`)
