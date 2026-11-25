import { isGearText, isPoeItemText } from './itemText'

export { DEFAULT_HOTKEY, HOTKEY_CHOICES, hotkeyLabel } from '../../shared/hotkeys'

export type ClipboardCheck = 'gear' | 'not-gear' | 'not-item'

/** What the clipboard holds when the hotkey is pressed. */
export function checkClipboard(text: string): ClipboardCheck {
  if (!isPoeItemText(text)) return 'not-item'
  return isGearText(text) ? 'gear' : 'not-gear'
}
