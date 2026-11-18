import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PobBridge } from '@core/pob/PobBridge'
import { resolveDevPobPaths } from '@core/pob/paths'

const ROOT = resolve(import.meta.dirname, '..', '..')
const paths = resolveDevPobPaths(ROOT)

const BODY_ARMOUR = `Item Class: Body Armours
Rarity: Rare
Gloom Shell
Iron Cuirass
--------
Item Level: 80
--------
+90 to maximum Life
+40% to Fire Resistance
+30% to Cold Resistance`

describe.skipIf(!paths)('PobBridge (real Path of Building engine)', () => {
  let bridge: PobBridge

  beforeAll(async () => {
    bridge = new PobBridge({
      ...paths!,
      bridgeScript: resolve(ROOT, 'resources', 'pob', 'bridge.lua')
    })
    await bridge.start()
  })

  afterAll(async () => {
    await bridge?.stop()
  })

  it('answers ping with the PoB version', async () => {
    const r = await bridge.ping()
    expect(r.pong).toBe(true)
    expect(r.version).toMatch(/^\d+\.\d+/)
  })

  it('creates a build and returns stats', async () => {
    const snap = await bridge.newBuild()
    expect(snap.info.level).toBe(1)
    expect(snap.stats.Life).toBeGreaterThan(0)
    expect(snap.stats.FireResist).toBe(-50) // PoB's default resistance penalty setting
  })

  it('round-trips a build code (zlib + base64 through FFI)', async () => {
    const { code } = await bridge.exportCode()
    expect(code).toMatch(/^[A-Za-z0-9_-]+=*$/)
    const snap = await bridge.loadCode(code)
    expect(snap.stats.Life).toBeGreaterThan(0)
  })

  it('compares a copied item against the empty slot', async () => {
    await bridge.newBuild()
    const cmp = await bridge.compareItem(BODY_ARMOUR)
    expect(cmp.slot).toBe('Body Armour')
    expect(cmp.diff.Life?.delta).toBe(90 + 5) // +90 flat, small % from base attributes
    expect(cmp.diff.FireResist?.delta).toBe(40)
    expect(cmp.diff.ColdResist?.delta).toBe(30)
    expect(cmp.diff.Armour?.after).toBeGreaterThan(0)
  })

  it('equips an item and keeps it after export/import', async () => {
    await bridge.newBuild()
    const equipped = await bridge.equipItem(BODY_ARMOUR)
    expect(equipped.slot).toBe('Body Armour')
    expect(equipped.stats.FireResist).toBe(-10)
    expect(equipped.items?.some((i) => i.slot === 'Body Armour' && i.base === 'Iron Cuirass')).toBe(true)

    const { code } = await bridge.exportCode()
    await bridge.newBuild()
    const reloaded = await bridge.loadCode(code)
    expect(reloaded.stats.FireResist).toBe(-10)

    // Comparing the same item again now changes nothing.
    const cmp = await bridge.compareItem(BODY_ARMOUR)
    expect(cmp.diff.FireResist).toBeUndefined()
  })

  it('reports engine errors without crashing the bridge', async () => {
    await expect(bridge.compareItem('not an item')).rejects.toThrow()
    const r = await bridge.ping()
    expect(r.pong).toBe(true)
  })

  it('rejects an invalid build code cleanly', async () => {
    await expect(bridge.loadCode('!!!notbase64')).rejects.toThrow(/invalid build code/)
  })
})
