import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '@core/db/Database'
import { MIGRATIONS } from '@core/db/migrations'
import { RunRepository } from '@core/db/RunRepository'
import { classifyArea, isSafeZone } from '@core/logs/areas'
import { parseSteamLibraries } from '@core/logs/findClientLog'
import { parseLine } from '@core/logs/parseLine'
import { resolveEnginePack, resolvePobPaths } from '@core/pob/paths'
import { RunTracker } from '@core/runs/RunTracker'
import { formatCurrency, formatDuration, formatStat, statLabel } from '../../src/renderer/src/format'

describe('database upgrade', () => {
  it('migrates a database created by an older version without losing data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'db-'))
    const path = join(dir, 'old.db')
    // Simulate a user who installed the first version (schema v1) and played a map.
    const old = new DatabaseSync(path)
    old.exec('CREATE TABLE schema_version (version INTEGER NOT NULL)')
    old.exec(MIGRATIONS[0]!.sql)
    old.prepare('INSERT INTO schema_version (version) VALUES (1)').run()
    old
      .prepare(
        `INSERT INTO runs (id, area_id, area_name, area_level, seed, started_at, ended_at, active_ms, deaths, reentries)
         VALUES ('old-run', 'MapCrypt', 'Crypt', 79, 1, '2026-11-18T19:00:00.000Z', '2026-11-18T19:05:00.000Z', 300000, 1, 0)`
      )
      .run()
    old.prepare("INSERT INTO settings (key, value) VALUES ('clientLogPath', 'C:/x/Client.txt')").run()
    old.close()

    const db = new AppDatabase(path)
    const v = db.db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number }
    expect(v.v).toBe(MIGRATIONS.at(-1)!.version)
    const [run] = new RunRepository(db.db).recent()
    expect(run).toMatchObject({ id: 'old-run', areaName: 'Crypt', deaths: 1, kind: 'map', outcome: null })
    expect(db.db.prepare("SELECT value FROM settings WHERE key = 'clientLogPath'").get()).toEqual({ value: 'C:/x/Client.txt' })
    db.close()

    // Opening again is a no-op.
    const again = new AppDatabase(path)
    const count = again.db.prepare('SELECT COUNT(*) AS n FROM schema_version').get() as { n: number }
    expect(count.n).toBe(MIGRATIONS.length)
    again.close()
  })
})

describe('area classification', () => {
  it('maps, hideouts, towns and other areas', () => {
    expect(classifyArea('MapCrypt')).toBe('map')
    expect(classifyArea('HideoutBattleground')).toBe('hideout')
    expect(classifyArea('MapHideoutFelled')).toBe('hideout')
    expect(classifyArea('G1_town')).toBe('town')
    expect(classifyArea('C_G2_town')).toBe('town')
    expect(classifyArea('G1_1')).toBe('other')
    expect(classifyArea('PinnacleArbiterArena')).toBe('other')
    expect(isSafeZone('hideout') && isSafeZone('town') && !isSafeZone('map')).toBe(true)
  })
})

describe('Steam library detection', () => {
  it('reads every library path from libraryfolders.vdf', () => {
    const vdf = `"libraryfolders"
{
  "0" { "path"  "C:\\\\Program Files (x86)\\\\Steam" "label" "" }
  "1" { "path"  "D:\\\\SteamLibrary" "apps" { "2694490" "123" } }
}`
    expect(parseSteamLibraries(vdf)).toEqual(['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary'])
    expect(parseSteamLibraries('garbage')).toEqual([])
  })
})

describe('engine lookup', () => {
  it('finds a complete engine pack and ignores incomplete ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'engine-'))
    expect(resolveEnginePack(dir)).toBeNull()
    const exe = process.platform === 'win32' ? 'luajit.exe' : 'luajit'
    mkdirSync(join(dir, 'bin'), { recursive: true })
    writeFileSync(join(dir, 'bin', exe), '')
    expect(resolveEnginePack(dir)).toBeNull() // no PoB yet
    mkdirSync(join(dir, 'pob', 'src'), { recursive: true })
    writeFileSync(join(dir, 'pob', 'src', 'HeadlessWrapper.lua'), '')
    const p = resolveEnginePack(dir)!
    expect(p.luajitPath).toBe(join(dir, 'bin', exe))
    expect(p.extraPath).toEqual([join(dir, 'bin')])
    // An installed app (resources/engine) wins over nothing else being present.
    const res = mkdtempSync(join(tmpdir(), 'res-'))
    expect(resolvePobPaths({ root: res, resourcesPath: join(dir, '..') })).toBeNull()
  })
})

describe('display formats', () => {
  it('durations, currency and stats', () => {
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(3_725_000)).toBe('1h 02m')
    expect(formatCurrency(2.5, 500)).toBe('2.50 div')
    expect(formatCurrency(12, 500)).toBe('12 div')
    expect(formatCurrency(0.1, 500)).toBe('50 ex')
    expect(formatCurrency(0.005, 500)).toBe('2.5 ex')
    expect(formatCurrency(0.1, null)).toBe('0.10 div')
    expect(formatCurrency(1, 500, { sign: true })).toBe('+1.00 div')
    expect(formatCurrency(-0.1, 500, { sign: true })).toBe('-50 ex')
    expect(formatStat('FireResist', 74.6)).toBe('75%')
    expect(formatStat('EffectiveMovementSpeedMod', 0.95)).toBe('95%')
    expect(formatStat('CritChance', 5.25)).toBe('5.3%')
    expect(formatStat('CombinedDPS', 123456.7)).toBe((123457).toLocaleString())
    expect(statLabel('CombinedDPS')).toBe('Total DPS')
    expect(statLabel('Unknown')).toBe('Unknown')
  })
})

describe('performance on a long Client.txt', () => {
  it('parses and tracks 200 000 lines quickly', () => {
    const lines: string[] = []
    const base = new Date(2026, 10, 18, 12, 0, 0).getTime()
    let t = 0
    const stamp = () => {
      const d = new Date(base + t++ * 1000)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} 1 abc [INFO Client 1]`
    }
    for (let i = 0; i < 2000; i++) {
      lines.push(`${stamp()} Generating level 80 area "MapCrypt" with seed ${i + 2}`)
      for (let k = 0; k < 96; k++) lines.push(`${stamp()} Tile hash: ${k}`)
      lines.push(`${stamp()} : Someone has been slain.`)
      lines.push(`${stamp()} Generating level 60 area "HideoutBattleground" with seed 1`)
      lines.push(`${stamp()} @From Buyer: hi`)
    }
    const tracker = new RunTracker()
    let completed = 0
    tracker.on((e) => {
      if (e.type === 'run_completed') completed++
    })
    const start = performance.now()
    for (const l of lines) {
      const e = parseLine(l)
      if (e) tracker.handle(e)
    }
    const ms = performance.now() - start
    expect(lines.length).toBe(200_000)
    expect(completed).toBe(1999)
    expect(ms).toBeLessThan(2000)
  })
})
