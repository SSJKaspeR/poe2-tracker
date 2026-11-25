/**
 * Hotkey that reads the clipboard once to compare the item just copied in game.
 * Flow for the player: hover the item, Ctrl+C (the game copies it), then the hotkey.
 * Ctrl+Alt+C is avoided: PoE uses it for the advanced item copy.
 */
export const HOTKEY_CHOICES = [
  { accelerator: 'CommandOrControl+Shift+C', label: 'Ctrl+Shift+C' },
  { accelerator: 'CommandOrControl+Shift+X', label: 'Ctrl+Shift+X' },
  { accelerator: 'Alt+C', label: 'Alt+C' },
  { accelerator: 'F6', label: 'F6' },
  { accelerator: 'F7', label: 'F7' }
] as const

export const DEFAULT_HOTKEY = HOTKEY_CHOICES[0].accelerator

export function hotkeyLabel(accelerator: string | null): string | null {
  if (!accelerator) return null
  return HOTKEY_CHOICES.find((c) => c.accelerator === accelerator)?.label ?? accelerator
}
