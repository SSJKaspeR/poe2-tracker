import { describe, expect, it } from 'vitest'
import { checkClipboard, DEFAULT_HOTKEY, HOTKEY_CHOICES, hotkeyLabel } from '@core/clipboard/compareHotkey'
import { isGearText, isPoeItemText, itemClass } from '@core/clipboard/itemText'

const item = (cls: string) => `Item Class: ${cls}\r\nRarity: Rare\r\nX\r\n--------\r\nY`

describe('item text from the clipboard', () => {
  it('recognises PoE item text', () => {
    expect(isPoeItemText(item('Rings'))).toBe(true)
    expect(isPoeItemText('  \nItem Class: Rings\nRarity: Rare\nX')).toBe(true)
    expect(isPoeItemText('hello')).toBe(false)
    expect(isPoeItemText('Item Class: Rings')).toBe(false)
  })

  it('keeps equipment and ignores currency, waystones and gems (price checkers copy those too)', () => {
    expect(itemClass(item('Body Armours'))).toBe('Body Armours')
    for (const c of ['Body Armours', 'Rings', 'Quarterstaves', 'Crossbows', 'Foci', 'Life Flasks', 'Charms', 'Jewels', 'Two Hand Swords']) {
      expect(isGearText(item(c))).toBe(true)
    }
    for (const c of ['Stackable Currency', 'Waystones', 'Tablet', 'Skill Gems', 'Support Gems', 'Socketable', 'Omen', 'Relics']) {
      expect(isGearText(item(c))).toBe(false)
    }
  })
})

describe('compare hotkey (one clipboard read per key press)', () => {
  it('tells the player what was in the clipboard', () => {
    expect(checkClipboard(item('Helmets'))).toBe('gear')
    expect(checkClipboard(item('Stackable Currency'))).toBe('not-gear')
    expect(checkClipboard('some text from a browser')).toBe('not-item')
  })

  it('hotkeys avoid the game copy shortcuts', () => {
    expect(DEFAULT_HOTKEY).toBe('CommandOrControl+Shift+C')
    for (const c of HOTKEY_CHOICES) expect(['CommandOrControl+C', 'CommandOrControl+Alt+C']).not.toContain(c.accelerator)
    expect(hotkeyLabel(DEFAULT_HOTKEY)).toBe('Ctrl+Shift+C')
    expect(hotkeyLabel(null)).toBeNull()
  })
})
