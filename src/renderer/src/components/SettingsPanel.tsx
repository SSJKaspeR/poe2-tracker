import { useEffect, useState } from 'react'
import type { AiProviderId } from '@shared/ipc'
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
        className="max-h-[90vh] w-[480px] overflow-y-auto rounded-lg border border-stone-700 bg-stone-900 p-5 shadow-xl"
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
        <AiSettings />
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>{t('Close')}</Button>
        </div>
      </div>
    </div>
  )
}

const DEFAULT_MODELS: Record<AiProviderId, string> = { anthropic: 'claude-haiku-5-5', openai: 'gpt-6-luna', ollama: 'qwen3:4b' }

/** Optional AI explanations: provider, model, API key. Off by default. */
function AiSettings() {
  const t = useT()
  const ai = useTracker((s) => s.status?.ai)
  const setStatus = useTracker((s) => s.setStatus)
  const [key, setKey] = useState('')
  const [model, setModel] = useState(ai?.model ?? '')
  const [installed, setInstalled] = useState<string[] | null>(null)
  const [ollamaError, setOllamaError] = useState<string | null>(null)

  useEffect(() => setModel(ai?.model ?? ''), [ai?.provider, ai?.model])
  useEffect(() => {
    setInstalled(null)
    setOllamaError(null)
    if (ai?.provider !== 'ollama') return
    void window.tracker.ollamaModels().then((r) => (r.ok ? setInstalled(r.value) : setOllamaError(r.error)))
  }, [ai?.provider])

  if (!ai) return null
  const save = (change: Parameters<typeof window.tracker.setAi>[0]) => void window.tracker.setAi(change).then(setStatus)

  return (
    <div className="mt-4 space-y-3 border-t border-stone-800 pt-4 text-sm">
      <label className="flex items-start justify-between gap-4">
        <span>
          <span className="block text-stone-300">{t('AI explanations (optional)')}</span>
          <span className="text-xs text-stone-500">
            {t(
              'Plain-language advice from your build numbers. Sent only when you click, and only the numbers and the app findings (never your account or files). Your provider bills it (usually under 1 cent per answer); Ollama runs free on your PC.'
            )}
          </span>
        </span>
        <select
          aria-label={t('AI explanations (optional)')}
          className="rounded-md border border-stone-700 bg-stone-950 px-2 py-1"
          value={ai.provider ?? ''}
          onChange={(e) => save({ provider: (e.target.value || null) as AiProviderId | null })}
        >
          <option value="">{t('Off')}</option>
          <option value="anthropic">Claude (Anthropic)</option>
          <option value="openai">OpenAI</option>
          <option value="ollama">{t('Ollama (local, free)')}</option>
        </select>
      </label>

      {ai.provider && (
        <label className="flex items-center justify-between gap-4">
          <span className="text-stone-300">{t('Model')}</span>
          <span className="flex items-center gap-2">
            <input
              aria-label={t('Model')}
              list="ai-models"
              className="w-48 rounded-md border border-stone-700 bg-stone-950 px-2 py-1"
              value={model}
              placeholder={DEFAULT_MODELS[ai.provider]}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => model !== ai.model && save({ model })}
            />
            <datalist id="ai-models">
              {(ai.provider === 'ollama' ? (installed ?? []) : [DEFAULT_MODELS[ai.provider]]).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </span>
        </label>
      )}
      {ai.provider === 'ollama' && (
        <p className="text-xs text-stone-500">
          {ollamaError ??
            (installed && installed.length === 0
              ? t('Ollama has no model yet: run "ollama pull {model}" first.', { model: DEFAULT_MODELS.ollama })
              : installed
                ? t('Installed: {models}', { models: installed.join(', ') })
                : '')}
        </p>
      )}

      {(ai.provider === 'anthropic' || ai.provider === 'openai') && (
        <div className="space-y-1">
          {ai.key ? (
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-emerald-400">
                {ai.key === 'saved'
                  ? t('API key saved, encrypted, on this computer.')
                  : t('API key kept until you close the app (no secure storage on this system).')}
              </span>
              <Button variant="ghost" onClick={() => save({ apiKey: null })}>
                {t('Remove the key')}
              </Button>
            </div>
          ) : (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (key.trim()) save({ apiKey: key })
                setKey('')
              }}
            >
              <input
                type="password"
                aria-label={t('API key')}
                autoComplete="off"
                className="min-w-0 flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1"
                placeholder={ai.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <Button
                disabled={!key.trim()}
                onClick={() => {
                  save({ apiKey: key })
                  setKey('')
                }}
              >
                {t('Save key')}
              </Button>
            </form>
          )}
          <p className="text-xs text-stone-500">
            {ai.provider === 'anthropic'
              ? t('Create a key at console.anthropic.com (API keys).')
              : t('Create a key at platform.openai.com (API keys).')}
          </p>
        </div>
      )}
    </div>
  )
}
