/**
 * Integration tests of the whole service (everything the UI calls), with the
 * real PoB engine, a real SQLite file, a real Client.txt on disk and a fake
 * poe.ninja. Each test starts from a fresh data folder unless it says otherwise.
 */
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AxiosInstance } from 'axios'
import { afterEach, describe, expect, it } from 'vitest'
import { SqlitePriceCache } from '@core/db/SqlitePriceCache'
import { AppDatabase } from '@core/db/Database'
import { resolvePobPaths } from '@core/pob/paths'
import { PoeNinjaClient } from '@core/pricing/PoeNinjaClient'
import { TrackerService } from '../../src/main/TrackerService'

const ROOT = resolve(import.meta.dirname, '..', '..')
const paths = resolvePobPaths({ root: ROOT })
const fx = (n: string) => readFileSync(resolve(ROOT, 'tests', 'fixtures', n), 'utf8').trim()

const ITEM = `Item Class: Body Armours
Rarity: Rare
Gloom Shell
Iron Cuirass
--------
Item Level: 80
--------
+90 to maximum Life
+40% to Fire Resistance`

// ── Fake poe.ninja ──────────────────────────────────────────────────────────

function fakeNinja(opts: { leaguesFail?: () => boolean; cachePath?: string } = {}) {
  const calls: string[] = []
  const clock = { now: Date.now() }
  const http = {
    get: async (url: string, cfg?: { params?: { type?: string } }) => {
      calls.push(`${url}?${cfg?.params?.type ?? ''}`)
      if (url.endsWith('/leagues')) {
        if (opts.leaguesFail?.()) throw new Error('offline')
        return { data: [{ id: 'Test League', name: 'Test League' }, { id: 'Standard', name: 'Standard' }] }
      }
      const type = cfg?.params?.type
      if (url.includes('/exchange/') && type === 'Currency') {
        return {
          data: {
            core: { primary: 'divine', items: [{ id: 'divine', name: 'Divine Orb' }] },
            lines: [
              { id: 'exalted', primaryValue: 0.002 },
              { id: 'regal', primaryValue: 0.004 }
            ],
            items: [
              { id: 'exalted', name: 'Exalted Orb' },
              { id: 'regal', name: 'Regal Orb' }
            ]
          }
        }
      }
      if (url.includes('/stash/') && type === 'UniqueArmours') {
        return {
          data: { core: { primary: 'divine' }, lines: [{ id: 1, detailsId: 'black-sun-crest-wrapped-greathelm', name: 'Black Sun Crest', primaryValue: 4 }] }
        }
      }
      return { data: { lines: [], items: [] } }
    }
  }
  const client = new PoeNinjaClient({
    cache: new SqlitePriceCache(new AppDatabase(opts.cachePath ?? ':memory:').db),
    http: http as unknown as AxiosInstance,
    now: () => clock.now
  })
  // No 1.5 s politeness delay in tests.
  ;(client as unknown as { limiter: { schedule: <T>(f: () => Promise<T>) => Promise<T> } }).limiter = { schedule: (f) => f() }
  return { client, calls, clock }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const services: TrackerService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.stop().catch(() => undefined)))
  delete process.env.POE2_CLIENT_LOG
})

function folder() {
  const dir = mkdtempSync(join(tmpdir(), 'svc-'))
  const log = join(dir, 'Client.txt')
  writeFileSync(log, '')
  return { dir, db: join(dir, 'app.db'), log }
}

async function startService(
  f: { db: string; log: string },
  opts: {
    useLogEnv?: boolean
    ninja?: ReturnType<typeof fakeNinja>
    filterDirs?: string[]
    fetchText?: (url: string) => Promise<string>
  } = {}
) {
  if (opts.useLogEnv !== false) process.env.POE2_CLIENT_LOG = f.log
  else delete process.env.POE2_CLIENT_LOG
  const ninja = opts.ninja ?? fakeNinja()
  const svc = new TrackerService({
    dbPath: f.db,
    pob: { ...paths!, bridgeScript: resolve(ROOT, 'resources', 'pob', 'bridge.lua') },
    pricing: ninja.client,
    filterDirs: opts.filterDirs,
    fetchText: opts.fetchText
  })
  services.push(svc)
  await svc.start()
  await waitFor(() => svc.status().pob.running && svc.status().pob.version !== null, 'PoB ready')
  await waitFor(() => svc.status().prices.count > 0 || svc.status().prices.error !== null, 'prices')
  return svc
}

async function waitFor(cond: () => boolean, what: string, timeout = 15_000) {
  const end = Date.now() + timeout
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

const p2 = (n: number) => String(n).padStart(2, '0')
function line(d: Date, msg: string) {
  return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} 1000 abcdef12 [INFO Client 1] ${msg}\n`
}
const T0 = () => new Date(Date.now() - 30 * 60_000)
const at = (t0: Date, min: number) => new Date(t0.getTime() + min * 60_000)
const gen = (t0: Date, min: number, area: string, seed: number, lvl = 80) =>
  line(at(t0, min), `Generating level ${lvl} area "${area}" with seed ${seed}`)

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe.skipIf(!paths)('TrackerService (whole app logic, real engine)', () => {
  it('starts: reads Client.txt, loads PoB and prices, picks the league', async () => {
    const svc = await startService(folder())
    const s = svc.status()
    expect(s.logWatching).toBe(true)
    expect(s.pob.version).toMatch(/^\d+\.\d+/)
    expect(s.league).toBe('Test League')
    expect(s.prices.exaltedPerDivine).toBeCloseTo(500)
    expect(svc.searchPrices('exal')[0]?.name).toBe('Exalted Orb')
    expect(s.trackerState).toBe('idle')
  })

  it('tracks maps from Client.txt and keeps today stats', async () => {
    const f = folder()
    const svc = await startService(f)
    const t0 = T0()
    appendFileSync(
      f.log,
      gen(t0, 0, 'HideoutBattleground', 1) +
        gen(t0, 1, 'MapCrypt', 11) +
        line(at(t0, 1), ': You have entered Crypt.') +
        line(at(t0, 3), ': Kasper has been slain.') +
        gen(t0, 5, 'HideoutBattleground', 1) +
        gen(t0, 6, 'MapSavanna', 22)
    )
    await waitFor(() => svc.recentRuns().some((r) => r.endedAt), 'completed run')
    const done = svc.recentRuns().find((r) => r.endedAt)!
    expect(done).toMatchObject({ areaName: 'Crypt', deaths: 1, activeMs: 4 * 60_000, endReason: 'new_map' })
    expect(svc.status().currentRun?.areaId).toBe('MapSavanna')
    expect(svc.status().today).toMatchObject({ runs: 1, deaths: 1 })
    expect(svc.runsDetailed(1)).toHaveLength(1)
  })

  it('strategies: auto-applied to new maps, never to boss attempts; loot and profit', async () => {
    const f = folder()
    const svc = await startService(f)
    const [preset] = svc.savePreset({ name: 'T15', items: [{ kind: 'waystone', label: 'Waystone', quantity: 1, manualValue: 0.5 }] })
    svc.setActivePreset(preset!.id, true)
    const t0 = T0()
    appendFileSync(f.log, gen(t0, 0, 'MapCrypt', 11))
    await waitFor(() => svc.status().currentRun !== null, 'map started')
    const runId = svc.status().currentRun!.id
    expect(svc.runLines(runId).investments[0]).toMatchObject({ label: 'Waystone', unitValue: 0.5 })

    svc.addLoot(runId, { label: 'Exalted Orb', quantity: 1000 }) // 1000 × 0.002 = 2 div
    const lines = svc.addLoot(runId, { label: 'Junk', quantity: 1, manualValue: 0.1 })
    expect(lines.loot).toHaveLength(2)
    svc.removeLine(runId, 'loot', lines.loot[1]!.id)

    svc.startSession({ mode: 'boss', bossName: 'Arbiter of Ash' })
    appendFileSync(f.log, gen(t0, 5, 'HideoutBattleground', 1) + gen(t0, 6, 'PinnacleArbiterArena', 99))
    await waitFor(() => svc.status().currentRun?.areaId === 'PinnacleArbiterArena', 'boss attempt')
    const attempt = svc.status().currentRun!.id
    expect(svc.runLines(attempt)).toMatchObject({ kind: 'boss', investments: [] })

    const today = svc.status().todayProfit
    expect(today.invested).toBeCloseTo(0.5)
    expect(today.looted).toBeCloseTo(2)
    expect(today.profit).toBeCloseTo(1.5)
  })

  it('sessions: rush objective, boss attempts with outcome, hideout crafting, history', async () => {
    const f = folder()
    const svc = await startService(f)
    const t0 = T0()
    svc.startSession({ mode: 'maps', targetCount: 1 })
    appendFileSync(f.log, gen(t0, 0, 'MapCrypt', 11) + gen(t0, 4, 'HideoutBattleground', 1) + gen(t0, 5, 'MapSavanna', 22))
    await waitFor(() => svc.status().session?.completedRuns === 1, 'map in session')
    expect(svc.status().session?.objectiveReached).toBe(true)

    svc.startSession({ mode: 'boss', targetCount: 2 })
    appendFileSync(f.log, gen(t0, 9, 'HideoutBattleground', 1) + gen(t0, 10, 'PinnacleArena', 7))
    await waitFor(() => svc.status().currentRun?.areaId === 'PinnacleArena', 'boss attempt')
    svc.setRunOutcome(svc.status().currentRun!.id, 'kill')
    expect(svc.status().session).toMatchObject({ mode: 'boss', kills: 1, objectiveReached: false })

    svc.endSession()
    // Out of a boss session, arenas are not tracked as runs anymore.
    appendFileSync(f.log, gen(t0, 12, 'HideoutBattleground', 1) + gen(t0, 13, 'PinnacleArena', 8))
    await new Promise((r) => setTimeout(r, 1500))
    expect(svc.status().currentRun).toBeNull()

    svc.startSession({ mode: 'hideout', activity: 'craft' })
    const id = svc.status().session!.id
    svc.addSessionLine(id, { direction: 'spent', label: 'Exalted Orb', quantity: 100 })
    svc.addSessionLine(id, { direction: 'gained', label: 'Sale', quantity: 1, manualValue: 1 })
    expect(svc.status().session).toMatchObject({ spent: 0.2, gained: 1 })

    const history = svc.sessionHistory()
    expect(history.map((h) => h.mode)).toEqual(['hideout', 'boss', 'maps'])
    expect(history.filter((h) => h.endedAt === null)).toHaveLength(1)
  })

  it('builds: import, re-import, another character, equip, versions linked to runs', async () => {
    const f = folder()
    const svc = await startService(f)
    expect(unwrap(await svc.buildSnapshot())).toBeNull()

    unwrap(await svc.importBuild(fx('build-level1.pobcode'), { newBuild: false }))
    const first = svc.status().build!
    expect(first).toMatchObject({ versionCount: 1, versionLabel: 'Imported' })

    unwrap(await svc.importBuild(fx('build-level1.pobcode'), { newBuild: false }))
    expect(svc.status().build).toMatchObject({ buildId: first.buildId, versionCount: 2, versionLabel: 'Re-imported' })

    const t0 = T0()
    appendFileSync(f.log, gen(t0, 0, 'MapCrypt', 11))
    await waitFor(() => svc.status().currentRun !== null, 'map')

    const equipped = unwrap(await svc.equipItem(ITEM))
    expect(equipped.stats.FireResist).toBe(-10)
    expect(svc.status().build).toMatchObject({ versionCount: 3, versionLabel: 'Equipped Gloom Shell (Body Armour)' })

    appendFileSync(f.log, gen(t0, 5, 'MapSavanna', 22))
    await waitFor(() => svc.recentRuns().some((r) => r.endedAt), 'first map done')
    const perf = svc.versionPerformance()
    // The finished map started with v2, before the item was equipped.
    expect(perf.find((p) => p.label === 'Re-imported')?.runs).toBe(1)
    expect(svc.buildVersions()[0]!.stats?.FireResist).toBe(-10)

    unwrap(await svc.importBuild(fx('build-player-treegems.pobcode'), { newBuild: true, name: 'Alt' }))
    expect(svc.status().build).toMatchObject({ name: 'Alt', versionCount: 1 })
    expect(svc.status().build!.buildId).not.toBe(first.buildId)
  })

  it('imports a build from a sharing link (one download) and reports bad input', async () => {
    const urls: string[] = []
    const svc = await startService(folder(), {
      fetchText: async (url) => {
        urls.push(url)
        return fx('build-level1.pobcode')
      }
    })
    const snap = unwrap(await svc.importBuild('https://pobb.in/Ab12', { newBuild: false }))
    expect(snap.info.className).toBeTruthy()
    expect(urls).toEqual(['https://pobb.in/pob/Ab12'])
    expect(await svc.importBuild('just some text', { newBuild: false })).toMatchObject({ ok: false, error: expect.stringMatching(/Not a PoB code/) })
    expect(urls).toHaveLength(1)
  })

  it('compare hotkey: one clipboard read per press, equipment only, misses reported', async () => {
    const svc = await startService(folder())
    unwrap(await svc.importBuild(fx('build-level1.pobcode'), { newBuild: false }))
    const seen: unknown[] = []
    const misses: string[] = []
    svc.on('item-compared', (r) => seen.push(r))
    svc.on('hotkey-miss', (r) => misses.push(r))
    expect(await svc.onCompareHotkey(ITEM)).toBe('gear')
    expect(seen).toEqual([expect.objectContaining({ ok: true, value: expect.objectContaining({ slot: 'Body Armour', itemText: ITEM }) })])
    // Currency (e.g. just price checked with Exiled Exchange 2) and random text: told, not compared.
    expect(await svc.onCompareHotkey('Item Class: Stackable Currency\nRarity: Currency\nExalted Orb\n--------\nStack Size: 1/20')).toBe('not-gear')
    expect(await svc.onCompareHotkey('https://poe.ninja')).toBe('not-item')
    expect(misses).toEqual(['not-gear', 'not-item'])
    expect(seen).toHaveLength(1)
    // A bad gear copy is reported, not thrown.
    await svc.onCompareHotkey('Item Class: Body Armours\nRarity: Rare\nWhat\nNot A Base')
    expect(seen[1]).toMatchObject({ ok: false })
  })

  it('compare hotkey setting: default, change, off, and the old "Auto" switch', async () => {
    const f = folder()
    const svc = await startService(f)
    expect(svc.status().compareHotkey).toEqual({ accelerator: 'CommandOrControl+Shift+C', label: 'Ctrl+Shift+C', error: null })
    svc.setCompareHotkey('F7')
    expect(svc.status().compareHotkey.label).toBe('F7')
    svc.setCompareHotkey(null)
    expect(svc.status().compareHotkey.accelerator).toBeNull()
    await svc.stop()
    services.splice(services.indexOf(svc), 1)

    // A player who had turned "Auto (Ctrl+C)" off keeps it off.
    const db = new AppDatabase(join(f.dir, 'old.db'))
    db.db.prepare("INSERT INTO settings (key, value) VALUES ('clipboardWatch', '0')").run()
    db.close()
    const old = await startService({ ...f, db: join(f.dir, 'old.db') })
    expect(old.status().compareHotkey.accelerator).toBeNull()
  })

  it('gear check and guide comparison (gear, tree, gems)', async () => {
    const svc = await startService(folder(), { ninja: fakeNinja() })
    unwrap(await svc.importBuild(fx('build-level1.pobcode'), { newBuild: false }))
    unwrap(await svc.equipItem(ITEM))
    const gear = unwrap(await svc.gearCheck())
    expect(gear.find((g) => g.slot === 'Body Armour')?.findings.map((x) => x.kind)).toEqual(
      expect.arrayContaining(['missing_socket', 'open_affix', 'quality'])
    )

    const cmp = unwrap(await svc.setGuideBuild(fx('build-guide.pobcode'), 'Guide'))
    const helmet = cmp.slots.find((s) => s.slot === 'Helmet')!
    expect(helmet).toMatchObject({ status: 'empty', uniquePrice: 4 })
    expect(helmet.impact?.CombinedDPS?.delta).toBeGreaterThan(0)

    const tree = unwrap(await svc.setGuideBuild(fx('build-guide-treegems.pobcode'), 'Tree'))
    expect(tree.tree?.missing.keystones.map((k) => k.name)).toEqual(['Heartstopper'])
    expect(tree.skills?.skills.map((s) => [s.skill, s.status])).toEqual([
      ['Lightning Arrow', 'missing'],
      ['Ice Nova', 'missing']
    ])
    svc.clearGuideBuild()
    expect(unwrap(await svc.guideComparison())).toBeNull()
  })

  it('reading a guide never swaps the player build, even with comparisons running at the same time', async () => {
    const svc = await startService(folder())
    unwrap(await svc.importBuild(fx('build-level1.pobcode'), { newBuild: false }))
    unwrap(await svc.equipItem(ITEM))
    const before = unwrap(await svc.buildSnapshot())!.stats
    const results = await Promise.all([
      svc.setGuideBuild(fx('build-guide-treegems.pobcode'), 'G'),
      svc.compareItem(ITEM),
      svc.compareItem(ITEM),
      svc.gearCheck(),
      svc.buildSnapshot()
    ])
    for (const r of results) expect(r.ok).toBe(true)
    // Comparisons were made against the player's build (the item is already equipped: no change).
    const cmp = results[1] as { ok: true; value: { diff: Record<string, unknown> } }
    expect(cmp.value.diff.FireResist).toBeUndefined()
    const snap = results[4] as { ok: true; value: { stats: Record<string, number> } }
    expect(snap.value.stats.FireResist).toBe(before.FireResist)
    expect(unwrap(await svc.buildSnapshot())!.stats).toEqual(before)
  })

  it('prices: overlapping refreshes and restarts send no extra requests while the cache is fresh', async () => {
    const f = folder()
    const cachePath = join(f.dir, 'prices.db')
    const ninja = fakeNinja({ cachePath })
    let svc = await startService(f, { ninja })
    const afterStart = ninja.calls.length
    await Promise.all([svc.refreshPrices(), svc.refreshPrices(), svc.refreshPrices()])
    expect(ninja.calls.length).toBe(afterStart)
    expect(svc.status().prices.requestsLastHour).toBe(afterStart)
    await svc.stop()
    services.splice(services.indexOf(svc), 1)
    // Restart with a fresh client but the same database: the saved cache is still fresh.
    const ninja2 = fakeNinja({ cachePath })
    svc = await startService(f, { ninja: ninja2 })
    expect(ninja2.calls).toEqual([])
  })

  it('prices: retries the league when poe.ninja was down at startup', async () => {
    let down = true
    const ninja = fakeNinja({ leaguesFail: () => down })
    const svc = await startService(folder(), { ninja })
    expect(svc.status().league).toBeNull()
    expect(svc.status().prices.error).toMatch(/paused|unreachable/)
    down = false
    await svc.refreshPrices() // still in the 10 min back-off: nothing sent
    expect(svc.status().league).toBeNull()
    ninja.clock.now += 11 * 60_000
    await svc.refreshPrices()
    expect(svc.status().league).toBe('Test League')
  })
})

describe.skipIf(!paths)('TrackerService gear advice', () => {
  it('item sheets, runes for empty sockets, upgrade priorities (cached), comparison verdict', async () => {
    const svc = await startService(folder())
    unwrap(await svc.importBuild(fx('build-guide.pobcode'), { newBuild: false }))

    const sheets = unwrap(await svc.itemSheets())
    const body = sheets.find((x) => x.slot === 'Body Armour')!
    expect(body.lines.find((l) => l.text === '+120 to maximum Life')?.effects[0]).toMatch(/survivability/)
    expect(body.lines.find((l) => l.text === '+40% to Fire Resistance')?.effects[0]).toMatch(/^Fire resistance \+40%/)

    const prio = unwrap(await svc.upgradePriorities())
    expect(prio.length).toBeGreaterThan(0)
    expect(prio.map((p) => p.score)).toEqual([...prio.map((p) => p.score)].sort((a, b) => b - a))
    for (const p of prio) for (const l of p.lookFor) expect(l).toMatch(/^[+\d]/)
    const t = Date.now()
    expect(unwrap(await svc.upgradePriorities())).toBe(prio) // same build version: cached
    expect(Date.now() - t).toBeLessThan(50)

    // No socket on the guide's gear: no rune advice. Equip an armour with 2 empty sockets.
    expect(unwrap(await svc.runeAdvice())).toEqual([])
    // Same order as the game's copy: sockets before the item level.
    unwrap(await svc.equipItem(ITEM.replace('Iron Cuirass\n--------', 'Iron Cuirass\n--------\nSockets: S S\n--------')))
    const runes = unwrap(await svc.runeAdvice())
    expect(runes).toEqual([expect.objectContaining({ slot: 'Body Armour', empty: 2 })])
    expect(runes[0]!.options.length).toBeGreaterThan(0)
    expect(runes[0]!.options[0]!.impact.length).toBeGreaterThan(0)

    // The same armour, identical: nothing to say. A weaker copy: a downgrade, explained.
    expect(unwrap(await svc.compareItem(ITEM)).verdict).toEqual({ tone: 'same', text: 'No real difference for your build.' })
    const worse = unwrap(await svc.compareItem(ITEM.replace('+90 to maximum Life', '+10 to maximum Life')))
    expect(worse.verdict).toMatchObject({ tone: 'worse', text: expect.stringMatching(/^Downgrade: .*survivability/) })
    expect(worse.impact?.length).toBeGreaterThan(0)
  })
})

describe.skipIf(!paths)('TrackerService optimisations (tree & supports)', () => {
  it('best next points, respecs checked by PoB, supports of the main skill', async () => {
    const svc = await startService(folder())
    unwrap(await svc.importBuild(fx('build-guide-treegems.pobcode'), { newBuild: false }))
    // Lightning Arrow needs a bow to deal damage.
    unwrap(await svc.equipItem('Item Class: Bows\nRarity: Normal\nCrude Bow\n--------\nItem Level: 10'))
    const o = unwrap(await svc.optimisations())

    expect(o.tree.adds.length).toBeGreaterThan(0)
    expect(o.tree.adds.map((a) => a.perPoint)).toEqual([...o.tree.adds.map((a) => a.perPoint)].sort((a, b) => b - a))
    expect(o.tree.adds.every((a) => a.cost >= 1 && a.cost <= 5 && a.impact.length > 0)).toBe(true)
    expect(o.tree.removes.length).toBeGreaterThan(0)
    for (const s of o.tree.swaps) expect(s.removePoints).toBeGreaterThanOrEqual(s.addPoints)

    const sup = o.supports!
    expect(sup.skill).toBe('Lightning Arrow')
    expect(sup.current.map((c) => c.name)).toEqual(['Lightning Penetration', 'Multishot I'])
    expect(sup.current[0]!.note).toBeNull()
    expect(sup.current[1]!.note).toMatch(/single-target/) // more projectiles: PoB's number goes down
    expect(sup.candidates.length).toBeGreaterThan(0)
    expect(sup.candidates.map((c) => c.name)).not.toContain('Lightning Penetration') // one copy per character
    expect(sup.swaps.every((s) => s.remove !== 'Multishot I')).toBe(true)

    // Once calculated, the best next passive shows up in the Dashboard verdicts.
    expect((await svc.verdicts()).map((v) => v.id)).toContain('build.next-point')

    const t = Date.now()
    expect(unwrap(await svc.optimisations())).toBe(o) // cached for this build version
    expect(Date.now() - t).toBeLessThan(50)
  })
})

describe.skipIf(!paths)('TrackerService loot filter', () => {
  it("finds the player's filter and lists priced items it hides", async () => {
    const f = folder()
    const filters = join(f.dir, 'Path of Exile 2')
    mkdirSync(filters)
    copyFileSync(resolve(ROOT, 'tests/fixtures/filters/neversink-6-uber-plus-strict.filter'), join(filters, 'NeverSink Uber Plus.filter'))
    copyFileSync(resolve(ROOT, 'tests/fixtures/filters/neversink-3-strict.filter'), join(filters, 'NeverSink Strict.filter'))
    writeFileSync(join(filters, 'poe2_production_Config.ini'), 'item_filter=NeverSink Uber Plus.filter\n')
    const svc = await startService(f, { filterDirs: [filters] })

    // Nothing is read before the player asks.
    expect(svc.lootFilter(1)).toMatchObject({ enabled: false, path: null, candidates: [] })
    svc.setLootFilter(null)
    const auto = svc.lootFilter(1)
    expect(auto).toMatchObject({ auto: true, error: null, info: { type: '6-UBER-PLUS-STRICT' } })
    expect(auto.candidates).toHaveLength(2)
    expect(auto.hidden).toEqual([expect.objectContaining({ name: 'Regal Orb', valueExalted: 2, uncertain: false })])
    expect(svc.lootFilter(5).hidden).toEqual([]) // threshold

    svc.setLootFilter(join(filters, 'NeverSink Strict.filter'))
    expect(svc.lootFilter(1)).toMatchObject({ auto: false, hidden: [], info: { type: '3-STRICT' } })
    svc.setLootFilter(null)
    expect(svc.lootFilter(1).auto).toBe(true)
    svc.disableLootFilter()
    expect(svc.lootFilter(1).enabled).toBe(false)
  })

  it('says so when no filter is found', async () => {
    const svc = await startService(folder(), { filterDirs: [] })
    svc.setLootFilter(null)
    expect(svc.lootFilter().error).toMatch(/No loot filter found/)
  })
})

describe.skipIf(!paths)('TrackerService trade upgrade search', () => {
  it('weights per slot (cached per build version), preview, and a trade URL for the league', async () => {
    const svc = await startService(folder())
    expect(await svc.tradeWeights('Body Armour')).toMatchObject({ ok: false, error: 'Import your build first' })
    unwrap(await svc.importBuild(fx('build-level1.pobcode'), { newBuild: false }))
    unwrap(await svc.equipItem(ITEM))
    const t0 = performance.now()
    const w = unwrap(await svc.tradeWeights('Body Armour'))
    const first = performance.now() - t0
    const t1 = performance.now()
    expect(unwrap(await svc.tradeWeights('Body Armour'))).toBe(w) // cached
    expect(performance.now() - t1).toBeLessThan(first)

    const { defaultChoices, previewMods, tradeSearchUrl } = await import('@shared/trade')
    const choices = defaultChoices(w.weights)
    const preview = unwrap(await svc.tradePreview('Body Armour', previewMods(choices)))
    expect(preview.lines.length).toBeGreaterThan(0)
    const url = tradeSearchUrl(choices, { league: svc.status().league!, category: w.category, minWeight: w.minWeight })
    expect(url).toMatch(/^https:\/\/www\.pathofexile\.com\/trade2\/search\/poe2\/Test%20League\?q=/)

    // A new build version gets fresh weights.
    unwrap(await svc.equipItem(ITEM.replace('+90 to maximum Life', '+10 to maximum Life')))
    expect(unwrap(await svc.tradeWeights('Body Armour'))).not.toBe(w)
  })
})

describe.skipIf(!paths)('TrackerService after a restart', () => {
  it('keeps the build, settings, strategies and active session; does not re-create past runs', async () => {
    const f = folder()
    const t0 = T0()
    let svc = await startService(f)
    unwrap(await svc.importBuild(fx('build-level1.pobcode'), { newBuild: false }))
    unwrap(await svc.equipItem(ITEM))
    const stats = unwrap(await svc.buildSnapshot())!.stats
    const [preset] = svc.savePreset({ name: 'T15', items: [{ kind: 'waystone', label: 'W', quantity: 1, manualValue: 0.5 }] })
    svc.setActivePreset(preset!.id, true)
    svc.startSession({ mode: 'boss' })
    appendFileSync(f.log, gen(t0, 0, 'MapCrypt', 11) + gen(t0, 4, 'HideoutBattleground', 1) + gen(t0, 5, 'MapSavanna', 22))
    await waitFor(() => svc.recentRuns().length === 2, 'runs before restart')
    await svc.stop()
    services.splice(services.indexOf(svc), 1)
    const runsBefore = svc.recentRuns.bind(svc)
    void runsBefore

    // Restart without the env override: the saved Client.txt path is used.
    svc = await startService(f, { useLogEnv: false })
    expect(svc.status().clientLogPath).toBe(f.log)
    expect(unwrap(await svc.buildSnapshot())!.stats).toEqual(stats)
    expect(svc.status().build?.versionCount).toBe(2)
    expect(svc.presets().map((p) => p.name)).toEqual(['T15'])
    expect(svc.status()).toMatchObject({ activePresetId: preset!.id, autoApplyPreset: true })
    expect(svc.status().session?.mode).toBe('boss')

    // Replaying the end of Client.txt at startup must not duplicate runs already saved.
    await new Promise((r) => setTimeout(r, 1500))
    expect(svc.recentRuns().length).toBe(2)

    // Boss tracking is restored with the session.
    appendFileSync(f.log, gen(t0, 9, 'HideoutBattleground', 1) + gen(t0, 10, 'PinnacleArena', 5))
    await waitFor(() => svc.status().currentRun?.areaId === 'PinnacleArena', 'boss attempt after restart')
  })

  it('picks up maps played while the app was closed', async () => {
    const f = folder()
    const t0 = T0()
    let svc = await startService(f)
    appendFileSync(f.log, gen(t0, 0, 'MapCrypt', 11) + gen(t0, 4, 'HideoutBattleground', 1))
    await waitFor(() => svc.status().currentRun !== null, 'first map')
    await svc.stop()
    services.splice(services.indexOf(svc), 1)

    // App closed: two more maps are played.
    appendFileSync(f.log, gen(t0, 5, 'MapSavanna', 22) + gen(t0, 9, 'MapBay', 33) + gen(t0, 13, 'HideoutBattleground', 1))
    svc = await startService(f, { useLogEnv: false })
    await waitFor(() => svc.recentRuns().filter((r) => r.areaId === 'MapSavanna').length === 1, 'catch-up', 5000)
    const ids = svc.recentRuns().map((r) => r.areaId).sort()
    expect(ids).toEqual(['MapBay', 'MapCrypt', 'MapSavanna'])
  })
})

describe.skipIf(!paths)('PoB engine crash', () => {
  it('restarts the engine and reloads the player build', async () => {
    const svc = await startService(folder())
    unwrap(await svc.importBuild(fx('build-level1.pobcode'), { newBuild: false }))
    unwrap(await svc.equipItem(ITEM))
    const stats = unwrap(await svc.buildSnapshot())!.stats
    const bridge = (svc as unknown as { pob: { kill: () => void } }).pob
    bridge.kill()
    await new Promise((r) => setTimeout(r, 300))
    // Next call works and still sees the player's build, not an empty one.
    const cmp = unwrap(await svc.compareItem(ITEM))
    expect(cmp.diff.FireResist).toBeUndefined()
    expect(unwrap(await svc.buildSnapshot())!.stats).toEqual(stats)
    expect(svc.status().pob.running).toBe(true)
  })
})
