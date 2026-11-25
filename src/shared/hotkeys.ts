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

/** Hotkey that shows or hides the in-game overlay. */
export const OVERLAY_HOTKEY_CHOICES = [
  { accelerator: 'CommandOrControl+Shift+O', label: 'Ctrl+Shift+O' },
  { accelerator: 'CommandOrControl+Shift+Z', label: 'Ctrl+Shift+Z' },
  { accelerator: 'Alt+O', label: 'Alt+O' },
  { accelerator: 'F8', label: 'F8' },
  { accelerator: 'F9', label: 'F9' }
] as const

export const DEFAULT_OVERLAY_HOTKEY = OVERLAY_HOTKEY_CHOICES[0].accelerator

export function overlayHotkeyLabel(accelerator: string | null): string | null {
  if (!accelerator) return null
  return OVERLAY_HOTKEY_CHOICES.find((c) => c.accelerator === accelerator)?.label ?? accelerator
}
