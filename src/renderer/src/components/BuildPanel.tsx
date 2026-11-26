import { useEffect, useState } from 'react'
import type { BuildSnapshotDTO, ItemComparisonDTO } from '@shared/ipc'
import { HOTKEY_CHOICES } from '@shared/hotkeys'
import type { ItemVerdict } from '@shared/impact'
import { STAT_LABELS, formatStat, isImprovement, statHelp, statLabel } from '../format'
import { useT, useTracker } from '../store'
import { AiExplain } from './AiExplain'
import { Button, Card } from './Card'

const KEY_STATS = ['CombinedDPS', 'Life', 'EnergyShield', 'Spirit', 'TotalEHP', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist']

export function BuildPanel() {
  const t = useT()
  const status = useTracker((s) => s.status)
  const pob = status?.pob
  const build = status?.build ?? null
  const [code, setCode] = useState('')
  const [newBuild, setNewBuild] = useState(false)
  const [snapshot, setSnapshot] = useState<BuildSnapshotDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showImport, setShowImport] = useState(false)

  const ready = Boolean(pob?.available && pob.running)
  const versionId = build?.versionId ?? null

  // Refresh the stats whenever the active version changes (import, equip, app start).
  useEffect(() => {
    if (!ready || versionId === null) {
      setSnapshot(null)
      return
    }
    void window.tracker.getBuildSnapshot().then((r) => r.ok && setSnapshot(r.value))
  }, [ready, versionId])

  async function importBuild(input = code) {
    setBusy(true)
    setError(null)
    const res = await window.tracker.importBuild(input, { newBuild: newBuild || !build })
    setBusy(false)
    if (res.ok) {
      setSnapshot(res.value)
      setCode('')
      setShowImport(false)
      setNewBuild(false)
    } else setError(res.error)
  }

  const importForm = (
    <>
      <textarea
        className="h-16 w-full resize-none rounded-md border border-stone-800 bg-stone-950 p-2 font-mono text-xs text-stone-300 outline-none focus:border-ember-500"
        placeholder={t('PoB code or link (pobb.in, poe.ninja, Maxroll…)')}
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      {build && (
        <label className="mt-1 flex items-center gap-2 text-xs text-stone-400">
          <input type="checkbox" className="accent-amber-500" checked={newBuild} onChange={(e) => setNewBuild(e.target.checked)} />
          {t('Another character (otherwise: new version of {build})', { build: build.name })}
        </label>
      )}
      <div className="mt-2 flex items-center gap-3">
        <Button
          onClick={async () => {
            const clip = (await window.tracker.readClipboardOnce()).trim()
            setCode(clip)
            void importBuild(clip)
          }}
          disabled={!ready || busy}
        >
          {busy ? t('Importing…') : t('Paste & import')}
        </Button>
        <Button variant="ghost" onClick={() => void importBuild()} disabled={!ready || busy || code.trim().length < 20}>
          {t('Import')}
        </Button>
        {build && (
          <Button variant="ghost" onClick={() => setShowImport(false)}>
            {t('Cancel')}
          </Button>
        )}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
      <p className="mt-2 text-xs text-stone-500">
        {t('Get your code: your character on poe.ninja → "Path of Building" export, or Import/Export in Path of Building.')}
      </p>
    </>
  )

  return (
    <Card title={t('Build')} actions={<EngineBadge />}>
      {build ? (
        <div className="mb-1">
          <div className="flex items-baseline justify-between">
            <div className="text-stone-100">{build.name}</div>
            {!showImport && (
              <button type="button" className="text-xs text-stone-500 hover:text-stone-200" onClick={() => setShowImport(true)}>
                {t('Re-import')}
              </button>
            )}
          </div>
          <div className="text-xs text-stone-500">
            v{build.versionCount} · {build.versionLabel ?? t('Imported')}
            {snapshot?.info.level ? ` · ${t('level {level}', { level: snapshot.info.level })}` : ''}
            {snapshot?.info.mainSkill ? ` · ${snapshot.info.mainSkill}` : ''}
          </div>
          {snapshot && (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {KEY_STATS.filter((k) => snapshot.stats[k] !== undefined).map((k) => (
                <div key={k} className="flex justify-between">
                  <dt className={`text-stone-500 ${statHelp(k) ? "cursor-help underline decoration-dotted decoration-stone-700 underline-offset-2" : ""}`} title={statHelp(k, t)}>{statLabel(k, t)}</dt>
                  <dd className="tabular-nums">{formatStat(k, snapshot.stats[k]!)}</dd>
                </div>
              ))}
            </dl>
          )}
          {showImport && <div className="mt-3">{importForm}</div>}
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-stone-500">{t('Paste your Path of Building code once. Every map is then linked to it.')}</p>
          {importForm}
        </>
      )}
    </Card>
  )
}

function EngineBadge() {
  const pob = useTracker((s) => s.status?.pob)
  const t = useT()
  if (!pob) return null
  const [label, color] = !pob.available
    ? [t('engine missing'), 'text-red-400']
    : pob.running
      ? [`engine ${pob.version ?? ''}`.trim(), 'text-emerald-400']
      : pob.error
        ? [t('engine error'), 'text-red-400']
        : [t('engine loading…'), 'text-stone-400']
  return (
    <span className={`text-xs ${color}`} title={pob.error ?? undefined}>
      ● {label}
    </span>
  )
}

export function ItemComparePanel() {
  const status = useTracker((s) => s.status)
  const setStatus = useTracker((s) => s.setStatus)
  const [text, setText] = useState('')
  const [result, setResult] = useState<ItemComparisonDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [equipped, setEquipped] = useState(false)
  const t = useT()
  const [miss, setMiss] = useState<'not-item' | 'not-gear' | null>(null)
  useEffect(() => window.tracker.onHotkeyMiss(setMiss), [])
  const missText =
    miss === 'not-gear'
      ? t('The item in your clipboard is not equipment (currency, waystone, gem…): nothing to compare.')
      : miss === 'not-item'
        ? t('No item in your clipboard: hover the item in game, press Ctrl+C, then the shortcut.')
        : null

  // Ctrl+C on an item in game → the main process compares it and pushes the result.
  useEffect(
    () =>
      window.tracker.onItemCompared((res) => {
        setEquipped(false)
        setMiss(null)
        if (res.ok) {
          setResult(res.value)
          setText(res.value.itemText ?? '')
          setError(null)
        } else {
          setResult(null)
          setError(res.error)
        }
      }),
    []
  )

  async function compare(itemText: string) {
    setError(null)
    setEquipped(false)
    const res = await window.tracker.compareItem(itemText)
    if (res.ok) setResult(res.value)
    else {
      setResult(null)
      setError(res.error)
    }
  }

  async function equip() {
    if (!result?.itemText) return
    const res = await window.tracker.equipItem(result.itemText)
    if (res.ok) setEquipped(true)
    else setError(res.error)
  }

  const changes = result
    ? Object.entries(result.diff)
        .filter(([k]) => STAT_LABELS[k])
        .sort(([a], [b]) => Object.keys(STAT_LABELS).indexOf(a) - Object.keys(STAT_LABELS).indexOf(b))
    : []

  return (
    <Card
      title={t('Compare an item')}
      actions={
        status && (
          <label
            className="flex items-center gap-1.5 text-xs text-stone-400"
            title={t(
              'In game: Ctrl+C on an item, then this shortcut. The app reads the clipboard once per press (GGG rules) and never sends keys to the game.'
            )}
          >
            {t('Shortcut')}
            <select
              aria-label={t('Compare shortcut')}
              className="rounded border border-stone-700 bg-stone-900 px-1.5 py-0.5 text-xs text-stone-200"
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
        )
      }
    >
      <textarea
        className="h-24 w-full resize-none rounded-md border border-stone-800 bg-stone-950 p-2 font-mono text-xs text-stone-300 outline-none focus:border-ember-500"
        placeholder={
          status?.compareHotkey.label
            ? t('In game: Ctrl+C on an item, then {shortcut} — or paste it here', { shortcut: status.compareHotkey.label })
            : t('Paste an item here (Ctrl+C on it in game)')
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text')
          if (pasted.includes('Rarity:')) void compare(pasted)
        }}
      />
      <div className="mt-2 flex items-center gap-3">
        <Button onClick={() => void compare(text)} disabled={!status?.pob.running || text.trim().length === 0}>
          {t('Compare')}
        </Button>
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
      {missText && <p className="mt-2 text-sm text-amber-400">{missText}</p>}
      {status?.compareHotkey.error && <p className="mt-2 text-sm text-amber-400">{status.compareHotkey.error}</p>}
      {result && (
        <div className="mt-3">
          <div className="text-sm text-stone-400">
            {result.item.name} → {t('replaces your')} <span className="text-stone-200">{result.slot}</span>
          </div>
          {result.verdict && <VerdictBox verdict={result.verdict} />}
          <div className="mt-2">
            <AiExplain topic={{ kind: 'comparison', comparison: result }} label={t('Explain with AI')} resetKey={result} />
          </div>
          {changes.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">{t('No change to your key stats.')}</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {changes.map(([k, c]) => (
                <li key={k} className="flex justify-between">
                  <span className="text-stone-400" title={statHelp(k, t)}>
                    {statLabel(k, t)}
                  </span>
                  <span className="tabular-nums">
                    <span className="text-stone-500">{formatStat(k, c.before)} → </span>
                    <span className={isImprovement(k, c.delta) ? 'text-emerald-400' : 'text-red-400'}>{formatStat(k, c.after)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {status?.build && (
            <div className="mt-3 flex items-center gap-3">
              <Button variant="ghost" disabled={equipped} onClick={() => void equip()}>
                {equipped ? t('Equipped ✓') : t('I equipped it')}
              </Button>
              <span className="text-xs text-stone-500">{t('Creates a new build version to compare results.')}</span>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

const VERDICT_STYLE: Record<ItemVerdict['tone'], string> = {
  better: 'border-emerald-700 bg-emerald-950/40 text-emerald-200',
  worse: 'border-red-800 bg-red-950/40 text-red-200',
  mixed: 'border-amber-700 bg-amber-950/30 text-amber-100',
  same: 'border-stone-700 bg-stone-900 text-stone-300'
}

/** One plain sentence on the comparison: upgrade, downgrade, or a trade-off explained. */
export function VerdictBox({ verdict }: { verdict: ItemVerdict }) {
  const t = useT()
  return (
    <p role="status" aria-label={t('Comparison verdict')} className={`mt-2 rounded-md border px-3 py-2 text-sm ${VERDICT_STYLE[verdict.tone]}`}>
      {verdict.text}
    </p>
  )
}

