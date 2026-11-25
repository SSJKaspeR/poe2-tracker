import { useEffect } from 'react'
import { HOTKEY_CHOICES, OVERLAY_HOTKEY_CHOICES } from '@shared/hotkeys'
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
          {status.compareHotkey.error && <p className="text-xs text-red-400">{status.compareHotkey.error}</p>}

          <div className="space-y-3 border-t border-stone-800 pt-4">
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-stone-300">{t('In-game overlay')}</span>
                <span className="text-xs text-stone-500">
                  {t('Map timer, profit and item verdicts over the game. Clicks go through it. Set the game to Windowed or Windowed Fullscreen.')}
                </span>
              </span>
              <input
                type="checkbox"
                aria-label={t('In-game overlay')}
                className="mt-1 accent-amber-500"
                checked={status.overlay.enabled}
                onChange={(e) => void window.tracker.setOverlay({ enabled: e.target.checked }).then(setStatus)}
              />
            </label>
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-stone-300">{t('Show / hide shortcut')}</span>
                <span className="text-xs text-stone-500">{t('Item verdicts still pop up when the overlay is hidden.')}</span>
              </span>
              <select
                aria-label={t('Show / hide shortcut')}
                className="rounded-md border border-stone-700 bg-stone-950 px-2 py-1"
                value={status.overlay.hotkey.accelerator ?? ''}
                onChange={(e) => void window.tracker.setOverlayHotkey(e.target.value || null).then(setStatus)}
              >
                {OVERLAY_HOTKEY_CHOICES.map((c) => (
                  <option key={c.accelerator} value={c.accelerator}>
                    {c.label}
                  </option>
                ))}
                <option value="">{t('Off')}</option>
              </select>
            </label>
            {status.overlay.hotkey.error && <p className="text-xs text-red-400">{status.overlay.hotkey.error}</p>}
            <div className="flex justify-end">
              <Button
                variant="ghost"
                disabled={!status.overlay.enabled}
                onClick={() => void window.tracker.setOverlay({ locked: !status.overlay.locked }).then(setStatus)}
              >
                {status.overlay.locked ? t('Move the overlay') : t('Lock the overlay')}
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>{t('Close')}</Button>
        </div>
      </div>
    </div>
  )
}
