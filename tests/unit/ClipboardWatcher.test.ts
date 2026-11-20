import { describe, expect, it } from 'vitest'
import { ClipboardWatcher, isPoeItemText } from '@core/clipboard/ClipboardWatcher'

const ITEM = 'Item Class: Body Armours\r\nRarity: Rare\r\nGloom Shell\r\nIron Cuirass'

describe('ClipboardWatcher', () => {
  it('recognises PoE item text only', () => {
    expect(isPoeItemText(ITEM)).toBe(true)
    expect(isPoeItemText('Rarity: Rare\nfoo')).toBe(false)
    expect(isPoeItemText('hello')).toBe(false)
  })

  it('fires once per new item copy and ignores the initial clipboard', async () => {
    let clip = ITEM
    const seen: string[] = []
    const w = new ClipboardWatcher(() => clip, (t) => seen.push(t))
    await w.start()
    await w.poll()
    expect(seen).toHaveLength(0) // already there before watching

    clip = 'some text'
    await w.poll()
    clip = ITEM
    await w.poll()
    await w.poll()
    expect(seen).toEqual([ITEM.replace(/\r\n/g, '\n')])
    w.stop()
  })

  it('survives clipboard read errors and async reads', async () => {
    const w = new ClipboardWatcher(() => {
      throw new Error('busy')
    }, () => {})
    await expect(w.poll()).resolves.toBeUndefined()

    const seen: string[] = []
    let clip = 'x'
    const a = new ClipboardWatcher(async () => clip, (t) => seen.push(t))
    await a.start()
    clip = ITEM
    await a.poll()
    expect(seen).toHaveLength(1)
  })
})

describe('gear filter (coexists with price checkers like Exiled Exchange 2)', () => {
  it('keeps equipment and ignores currency, waystones and gems', async () => {
    const { isGearText, itemClass } = await import('@core/clipboard/ClipboardWatcher')
    const item = (cls: string) => `Item Class: ${cls}\r\nRarity: Rare\r\nX\r\n--------\r\nY`
    expect(itemClass(item('Body Armours'))).toBe('Body Armours')
    for (const c of ['Body Armours', 'Rings', 'Quarterstaves', 'Crossbows', 'Foci', 'Life Flasks', 'Charms', 'Jewels', 'Two Hand Swords']) {
      expect(isGearText(item(c))).toBe(true)
    }
    for (const c of ['Stackable Currency', 'Waystones', 'Tablet', 'Skill Gems', 'Support Gems', 'Socketable', 'Omen', 'Relics']) {
      expect(isGearText(item(c))).toBe(false)
    }
    expect(isGearText('Body Armours')).toBe(false)
  })
})
