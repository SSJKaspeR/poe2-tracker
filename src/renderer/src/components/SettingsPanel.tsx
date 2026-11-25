import { useEffect } from 'react'
import { HOTKEY_CHOICES } from '@shared/hotkeys'
import { LANGS } from '@shared/i18n'
import { useT, useTracker } from '../store'
import { Button } from './Card'

/** Settings: language, automatic updates, compare shortcut. */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const t = useT()
  const status = useTracker((s) => s.status)
  const setStatus = useTracker((s) => s.setStatus)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!status) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('Settings')}
        className="w-[440px] rounded-lg border border-stone-700 bg-stone-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-300">{t('Settings')}</h2>
        <div className="space-y-4 text-sm">
          <label className="flex items-center justify-between gap-4">
            <span className="text-stone-300">{t('Language')}</span>
            <select
              aria-label={t('Language')}
              className="rounded-md border border-stone-700 bg-stone-950 px-2 py-1"
              value={status.language}
              onChange={(e) => void window.tracker.setLanguage(e.target.value as 'en' | 'fr').then(setStatus)}
            >
              {LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-stone-300">{t('Automatic updates')}</span>
              <span className="text-xs text-stone-500">
                {t('Checks GitHub at startup and every 6 hours; installs only when you restart. Installed Windows app only.')}
              </span>
            </span>
            <input
              type="checkbox"
              aria-label={t('Automatic updates')}
              className="mt-1 accent-amber-500"
              checked={status.updateChecks}
              onChange={(e) => void window.tracker.setAutoUpdates(e.target.checked).then(() => window.tracker.getStatus().then(setStatus))}
            />
          </label>

          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-stone-300">{t('Item comparison shortcut')}</span>
              <span className="text-xs text-stone-500">{t('In game: Ctrl+C on an item, then this shortcut.')}</span>
            </span>
            <select
              aria-label={t('Item comparison shortcut')}
              className="rounded-md border border-stone-700 bg-stone-950 px-2 py-1"
              value={status.compareHotkey.accelerator ?? ''}
              onChange={(e) => void window.tracker.setCompareHotkey(e.target.value || null).then(setStatus)}
            >
              {HOTKEY_CHOICES.map((c) => (
                <option key={c.accelerator} value={c.accelerator}>
                  {c.label}
                </option>
              ))}
              <option value="">{t('Off')}</option>
            </select>
          </label>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>{t('Close')}</Button>
        </div>
      </div>
    </div>
  )
}
