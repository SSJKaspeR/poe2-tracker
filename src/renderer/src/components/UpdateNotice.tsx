import { useEffect, useState } from 'react'
import type { UpdateStateDTO } from '@shared/ipc'
import { useT } from '../store'

/** Footer line: app version and update state; "Restart to update" when one is downloaded. */
export function UpdateNotice() {
  const t = useT()
  const [state, setState] = useState<UpdateStateDTO | null>(null)
  useEffect(() => {
    void window.tracker.getUpdateState().then(setState)
    return window.tracker.onUpdateChanged(setState)
  }, [])
  if (!state) return null

  const label = {
    disabled: '',
    idle: '',
    checking: t('checking for updates…'),
    'up-to-date': t('up to date'),
    downloading: t('downloading v{version}{progress}…', {
      version: state.available ?? '',
      progress: state.progress !== null ? ` (${state.progress}%)` : ''
    }),
    ready: t('v{version} is ready', { version: state.available ?? '' }),
    error: t('update check failed (will retry)')
  }[state.status]

  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <span title={state.error ?? undefined}>
        v{state.current}
        {label && ` · ${label}`}
      </span>
      {state.status === 'ready' && (
        <button
          type="button"
          className="rounded bg-ember-500 px-2 py-0.5 text-[11px] font-semibold text-stone-950 hover:bg-ember-400"
          onClick={() => void window.tracker.installUpdate()}
        >
          {t('Restart to update')}
        </button>
      )}
    </span>
  )
}
