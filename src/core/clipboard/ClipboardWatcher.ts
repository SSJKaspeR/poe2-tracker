/**
 * Watches the clipboard for item text copied in game (Ctrl+C on an item).
 * The PoE 2 client copies a plain-text block starting with "Item Class:".
 * Same technique as Sidekick / Exiled-Exchange: no game memory reading, no input injection.
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

export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null
  private last: string | null = null
  private polling = false

  constructor(
    /** Sync or async clipboard read (Electron's clipboard API is async from v45). */
    private readonly readText: () => string | Promise<string>,
    private readonly onItem: (text: string) => void,
    private readonly intervalMs = 400
  ) {}

  async start(): Promise<void> {
    if (this.timer) return
    // Don't fire for whatever was already in the clipboard when watching started.
    this.last = await this.safeRead()
    this.timer = setInterval(() => void this.poll(), this.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  get running(): boolean {
    return this.timer !== null
  }

  /** One polling step (exposed for tests). */
  async poll(): Promise<void> {
    if (this.polling) return // a slow read must not overlap the next tick
    this.polling = true
    try {
      const text = await this.safeRead()
      if (text === this.last) return
      this.last = text
      if (isPoeItemText(text)) this.onItem(text.replace(/\r\n/g, '\n'))
    } finally {
      this.polling = false
    }
  }

  private async safeRead(): Promise<string> {
    try {
      return (await this.readText()) ?? ''
    } catch {
      return ''
    }
  }
}
