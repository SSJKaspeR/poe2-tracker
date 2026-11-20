import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PobBridge } from '@core/pob/PobBridge'
import { resolvePobPaths } from '@core/pob/paths'
import { TrackerService } from '../../src/main/TrackerService'

const ROOT = resolve(import.meta.dirname, '..', '..')
const paths = resolvePobPaths({ root: ROOT })
const BRIDGE = resolve(ROOT, 'resources', 'pob', 'bridge.lua')
const ITEM = `Item Class: Body Armours
Rarity: Rare
Gloom Shell
Iron Cuirass
--------
+90 to maximum Life`

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((f) => f().catch(() => undefined)))
  delete process.env.POE2_CLIENT_LOG
})

describe('without the calculation engine', () => {
  it('map tracking and economy keep working; build features report a clear error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noengine-'))
    const log = join(dir, 'Client.txt')
    writeFileSync(log, '')
    process.env.POE2_CLIENT_LOG = log
    const svc = new TrackerService({ dbPath: join(dir, 'a.db'), pob: null })
    cleanup.push(() => svc.stop())
    await svc.start()
    expect(svc.status().pob).toMatchObject({ available: false, running: false })
    expect(svc.status().pob.error).toContain('not installed')
    const cmp = await svc.compareItem(ITEM)
    expect(cmp).toMatchObject({ ok: false })
    expect(await svc.importBuild('abc', { newBuild: false })).toMatchObject({ ok: false })
    expect(await svc.gearCheck()).toEqual({ ok: true, value: [] })

    const d = new Date(Date.now() - 60_000)
    const p = (n: number) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    appendFileSync(log, `${stamp} 1 a [INFO Client 1] Generating level 80 area "MapCrypt" with seed 5\n`)
    const end = Date.now() + 5000
    while (!svc.status().currentRun && Date.now() < end) await new Promise((r) => setTimeout(r, 50))
    expect(svc.status().currentRun?.areaId).toBe('MapCrypt')
  })
})

describe.skipIf(!paths)('engine bridge robustness', () => {
  it('a missing LuaJIT executable fails fast with a readable error', async () => {
    const bridge = new PobBridge({ ...paths!, luajitPath: join(tmpdir(), 'nope', 'luajit'), bridgeScript: BRIDGE, startupTimeoutMs: 5000 })
    await expect(bridge.start()).rejects.toThrow(/Failed to start LuaJIT|exited/)
  })

  it('a timed-out request does not break the next ones (late answers are ignored)', async () => {
    const bridge = new PobBridge({ ...paths!, bridgeScript: BRIDGE, requestTimeoutMs: 1 })
    cleanup.push(() => bridge.stop())
    await bridge.start()
    await expect(bridge.newBuild()).rejects.toThrow(/timed out/)
    // Same bridge, normal timeout through a fresh instance is not needed: raise the limit.
    ;(bridge as unknown as { opts: { requestTimeoutMs: number } }).opts.requestTimeoutMs = 30_000
    await new Promise((r) => setTimeout(r, 500)) // late answer of new_build arrives meanwhile
    const r = await bridge.ping()
    expect(r.pong).toBe(true)
  })

  it('handles a burst of 100 item comparisons (Ctrl+C spam)', async () => {
    const bridge = new PobBridge({ ...paths!, bridgeScript: BRIDGE })
    cleanup.push(() => bridge.stop())
    await bridge.newBuild()
    const start = performance.now()
    const results = await Promise.all(Array.from({ length: 100 }, () => bridge.compareItem(ITEM)))
    const ms = performance.now() - start
    expect(results.every((r) => r.diff.Life?.delta && r.diff.Life.delta > 0)).toBe(true)
    expect(ms).toBeLessThan(30_000)
    console.log(`100 comparisons in ${Math.round(ms)} ms`)
  })

  it('rejects malformed input without crashing', async () => {
    const bridge = new PobBridge({ ...paths!, bridgeScript: BRIDGE })
    cleanup.push(() => bridge.stop())
    await bridge.newBuild()
    for (const bad of ['', 'Rarity: Rare', 'x'.repeat(100_000), 'Item Class: Rings\nRarity: Unique\nNot A Real Unique\nGold Ring']) {
      await bridge.compareItem(bad).catch(() => undefined)
    }
    await expect(bridge.loadCode('')).rejects.toThrow()
    await expect(bridge.loadXml('<not xml')).rejects.toThrow()
    await expect(bridge.compareNode(999_999_999)).rejects.toThrow(/unknown node/)
    expect((await bridge.ping()).pong).toBe(true)
    // Fixture still loads afterwards.
    const code = readFileSync(resolve(ROOT, 'tests', 'fixtures', 'build-level1.pobcode'), 'utf8').trim()
    expect((await bridge.loadCode(code)).stats.Life).toBeGreaterThan(0)
  })
})

describe.skipIf(!paths)('build codes that decode but are not PoE 2 builds', () => {
  it('reports them instead of silently keeping the previous build', async () => {
    const { deflateSync } = await import('node:zlib')
    const toCode = (xml: string) => deflateSync(Buffer.from(xml)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
    const bridge = new PobBridge({ ...paths!, bridgeScript: BRIDGE })
    cleanup.push(() => bridge.stop())
    await bridge.newBuild()
    await expect(bridge.loadCode(toCode('hello'))).rejects.toThrow(/invalid build code/)
    await expect(bridge.loadCode(toCode('<PathOfBuilding><Build/></PathOfBuilding>'))).rejects.toThrow(/not a Path of Exile 2 build/)
  })
})
