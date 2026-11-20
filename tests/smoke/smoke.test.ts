/**
 * Smoke test: the main paths of the app in a few seconds, on the real PoB engine.
 * Part of `npm run check` (every change). The full batteries (`npm run check:full`)
 * cover the details and edge cases.
 */
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AxiosInstance } from 'axios'
import { afterAll, describe, expect, it } from 'vitest'
import { AppDatabase } from '@core/db/Database'
import { SqlitePriceCache } from '@core/db/SqlitePriceCache'
import { resolvePobPaths } from '@core/pob/paths'
import { PoeNinjaClient } from '@core/pricing/PoeNinjaClient'
import { TrackerService } from '../../src/main/TrackerService'

const ROOT = resolve(import.meta.dirname, '..', '..')
const paths = resolvePobPaths({ root: ROOT })

const ITEM = `Item Class: Body Armours
Rarity: Rare
Gloom Shell
Iron Cuirass
--------
Item Level: 80
--------
+90 to maximum Life
+40% to Fire Resistance`

function fakeNinja() {
  const http = {
    get: async (url: string, cfg?: { params?: { type?: string } }) => {
      if (url.endsWith('/leagues')) return { status: 200, headers: {}, data: [{ id: 'Smoke League', name: 'Smoke League' }] }
      if (cfg?.params?.type === 'Currency') {
        return {
          status: 200,
          headers: {},
          data: {
            core: { primary: 'divine', items: [{ id: 'divine', name: 'Divine Orb' }] },
            lines: [{ id: 'exalted', primaryValue: 0.002 }, { id: 'regal', primaryValue: 0.004 }],
            items: [{ id: 'exalted', name: 'Exalted Orb' }, { id: 'regal', name: 'Regal Orb' }]
          }
        }
      }
      return { status: 200, headers: {}, data: { lines: [], items: [] } }
    }
  }
  const client = new PoeNinjaClient({ cache: new SqlitePriceCache(new AppDatabase(':memory:').db), http: http as unknown as AxiosInstance, minTimeMs: 0 })
  return client
}

async function waitFor(cond: () => boolean, what: string, timeout = 15_000) {
  const end = Date.now() + timeout
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

const p2 = (n: number) => String(n).padStart(2, '0')
const line = (d: Date, msg: string) =>
  `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} 1000 abcdef12 [INFO Client 1] ${msg}\n`

describe.skipIf(!paths)('smoke: the app works end to end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poe2-smoke-'))
  const log = join(dir, 'Client.txt')
  writeFileSync(log, '')
  const filters = join(dir, 'Path of Exile 2')
  mkdirSync(filters)
  copyFileSync(resolve(ROOT, 'tests/fixtures/filters/neversink-6-uber-plus-strict.filter'), join(filters, 'NS.filter'))
  process.env.POE2_CLIENT_LOG = log
  const svc = new TrackerService({
    dbPath: join(dir, 'app.db'),
    pob: { ...paths!, bridgeScript: resolve(ROOT, 'resources', 'pob', 'bridge.lua') },
    pricing: fakeNinja(),
    filterDirs: [filters]
  })

  afterAll(async () => {
    await svc.stop()
    delete process.env.POE2_CLIENT_LOG
  })

  it('starts: engine, prices, league, Client.txt', async () => {
    await svc.start()
    await waitFor(() => svc.status().pob.running && svc.status().prices.count > 0, 'engine and prices')
    expect(svc.status()).toMatchObject({ league: 'Smoke League', logWatching: true })
  })

  it('tracks a map from Client.txt', async () => {
    const t0 = new Date(Date.now() - 20 * 60_000)
    const at = (m: number) => new Date(t0.getTime() + m * 60_000)
    appendFileSync(
      log,
      line(at(0), 'Generating level 79 area "MapCrypt" with seed 11') +
        line(at(4), 'Generating level 65 area "HideoutBattleground" with seed 1') +
        line(at(5), 'Generating level 79 area "MapSavanna" with seed 22')
    )
    await waitFor(() => svc.recentRuns().some((r) => r.endedAt), 'completed run')
    expect(svc.status().today.runs).toBe(1)
  })

  it('imports a build and compares a copied item', async () => {
    const code = readFileSync(resolve(ROOT, 'tests/fixtures/build-level1.pobcode'), 'utf8').trim()
    const imported = await svc.importBuild(code, { newBuild: false })
    expect(imported.ok).toBe(true)
    const cmp = await svc.compareItem(ITEM)
    expect(cmp.ok && cmp.value.slot).toBe('Body Armour')
  })

  it('reads the loot filter', () => {
    const lf = svc.lootFilter(1)
    expect(lf.error).toBeNull()
    expect(lf.hidden.map((h) => h.name)).toContain('Regal Orb')
  })
})
