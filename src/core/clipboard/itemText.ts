/**
 * Item text copied in game (Ctrl+C on an item): the PoE 2 client copies a plain-text
 * block starting with "Item Class:".
 *
 * GGG's overlay rules: "Reading from the screen or clipboard may only be performed once
 * per manual key press." So the app never watches the clipboard: it reads it once when
 * the player presses the app's hotkey (see compareHotkey.ts). No input is sent to the game.
 */

export function isPoeItemText(text: string): boolean {
  const t = text.trimStart()
  return t.startsWith('Item Class:') && /\nRarity: /.test(t)
}

/**
 * Equipment PoB can compare. Price checkers (Exiled Exchange 2: Ctrl+D) also copy items,
 * so currency, waystones, tablets, gems… copied while price checking are ignored.
 */
const GEAR_CLASS =
  /^(Body Armours|Helmets|Gloves|Boots|Shields|Foci|Bucklers|Quivers|Amulets|Rings|Belts|Life Flasks|Mana Flasks|Charms|Jewels|One Hand Maces|Two Hand Maces|Quarterstaves|Staves|Bows|Crossbows|Wands|Sceptres|Spears|Flails|Claws|Daggers|One Hand Swords|Two Hand Swords|One Hand Axes|Two Hand Axes|Talismans|Traps)$/

export function itemClass(text: string): string | null {
  return /^\s*Item Class: *(.+?) *\r?$/m.exec(text)?.[1] ?? null
}

export function isGearText(text: string): boolean {
  const cls = itemClass(text)
  return isPoeItemText(text) && cls !== null && GEAR_CLASS.test(cls)
}
