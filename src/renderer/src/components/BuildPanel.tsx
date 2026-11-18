import { useEffect, useState } from 'react'
import type { BuildSnapshotDTO, ItemComparisonDTO, VersionPerformanceDTO } from '@shared/ipc'
import { STAT_LABELS, formatDuration, formatStat, isImprovement } from '../format'
import { useMoney, useTracker } from '../store'
import { Button, Card } from './Card'

const KEY_STATS = ['CombinedDPS', 'Life', 'EnergyShield', 'Spirit', 'TotalEHP', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist']

export function BuildPanel() {
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

  async function importBuild() {
    setBusy(true)
    setError(null)
    const res = await window.tracker.importBuild(code, { newBuild: newBuild || !build })
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
        placeholder="PoB code (eNrt…)"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      {build && (
        <label className="mt-1 flex items-center gap-2 text-xs text-stone-400">
          <input type="checkbox" className="accent-amber-500" checked={newBuild} onChange={(e) => setNewBuild(e.target.checked)} />
          Another character (otherwise: new version of {build.name})
        </label>
      )}
      <div className="mt-2 flex items-center gap-3">
        <Button onClick={() => void importBuild()} disabled={!ready || busy || code.trim().length < 20}>
          {busy ? 'Importing…' : 'Import build'}
        </Button>
        {build && (
          <Button variant="ghost" onClick={() => setShowImport(false)}>
            Cancel
          </Button>
        )}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </>
  )

  return (
    <Card title="Build" actions={<EngineBadge />}>
      {build ? (
        <div className="mb-1">
          <div className="flex items-baseline justify-between">
            <div className="text-stone-100">{build.name}</div>
            {!showImport && (
              <button type="button" className="text-xs text-stone-500 hover:text-stone-200" onClick={() => setShowImport(true)}>
                Re-import
              </button>
            )}
          </div>
          <div className="text-xs text-stone-500">
            v{build.versionCount} · {build.versionLabel ?? 'Imported'}
            {snapshot?.info.level ? ` · level ${snapshot.info.level}` : ''}
            {snapshot?.info.mainSkill ? ` · ${snapshot.info.mainSkill}` : ''}
          </div>
          {snapshot && (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {KEY_STATS.filter((k) => snapshot.stats[k] !== undefined).map((k) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-stone-500">{STAT_LABELS[k] ?? k}</dt>
                  <dd className="tabular-nums">{formatStat(k, snapshot.stats[k]!)}</dd>
                </div>
              ))}
            </dl>
          )}
          {showImport && <div className="mt-3">{importForm}</div>}
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-stone-500">Paste your Path of Building code once. Every map is then linked to it.</p>
          {importForm}
        </>
      )}
    </Card>
  )
}

function EngineBadge() {
  const pob = useTracker((s) => s.status?.pob)
  if (!pob) return null
  const [label, color] = !pob.available
    ? ['engine missing', 'text-red-400']
    : pob.running
      ? [`engine ${pob.version ?? ''}`.trim(), 'text-emerald-400']
      : pob.error
        ? ['engine error', 'text-red-400']
        : ['engine loading…', 'text-stone-400']
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

  // Ctrl+C on an item in game → the main process compares it and pushes the result.
  useEffect(
    () =>
      window.tracker.onItemCompared((res) => {
        setEquipped(false)
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
      title="Compare an item"
      actions={
        status && (
          <label className="flex items-center gap-1.5 text-xs text-stone-400" title="Compare automatically when you press Ctrl+C on an item in game">
            <input
              type="checkbox"
              className="accent-amber-500"
              checked={status.clipboardWatch}
              onChange={(e) => void window.tracker.setClipboardWatch(e.target.checked).then(setStatus)}
            />
            Auto (Ctrl+C in game)
          </label>
        )
      }
    >
      <textarea
        className="h-24 w-full resize-none rounded-md border border-stone-800 bg-stone-950 p-2 font-mono text-xs text-stone-300 outline-none focus:border-ember-500"
        placeholder="Hover an item in game and press Ctrl+C — or paste it here"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text')
          if (pasted.includes('Rarity:')) void compare(pasted)
        }}
      />
      <div className="mt-2 flex items-center gap-3">
        <Button onClick={() => void compare(text)} disabled={!status?.pob.running || text.trim().length === 0}>
          Compare
        </Button>
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
      {result && (
        <div className="mt-3">
          <div className="text-sm text-stone-400">
            {result.item.name} → replaces your <span className="text-stone-200">{result.slot}</span>
          </div>
          {changes.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">No change to your key stats.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {changes.map(([k, c]) => (
                <li key={k} className="flex justify-between">
                  <span className="text-stone-400">{STAT_LABELS[k]}</span>
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
                {equipped ? 'Equipped ✓' : 'I equipped it'}
              </Button>
              <span className="text-xs text-stone-500">Creates a new build version to compare results.</span>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

/** Results per build version: did that change actually help? */
export function VersionHistory() {
  const status = useTracker((s) => s.status)
  const money = useMoney()
  const [rows, setRows] = useState<VersionPerformanceDTO[]>([])
  const versionId = status?.build?.versionId
  const todayRuns = status?.today.runs

  useEffect(() => {
    void window.tracker.getVersionPerformance().then(setRows)
  }, [versionId, todayRuns])

  if (!status?.build || rows.length < 2) return null
  return (
    <Card title="Build versions">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className="pb-2 font-normal">Version</th>
            <th className="pb-2 text-right font-normal">Maps</th>
            <th className="pb-2 text-right font-normal">Min / map</th>
            <th className="pb-2 text-right font-normal">Deaths / map</th>
            <th className="pb-2 text-right font-normal">Profit / h</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.versionId} className="border-t border-stone-800/70">
              <td className="max-w-40 truncate py-1.5" title={r.label ?? ''}>
                v{rows.length - i} <span className="text-stone-500">{r.label}</span>
              </td>
              <td className="py-1.5 text-right tabular-nums">{r.runs}</td>
              <td className="py-1.5 text-right tabular-nums">{r.runs ? formatDuration(r.activeMs / r.runs) : '—'}</td>
              <td className="py-1.5 text-right tabular-nums">{r.runs ? (r.deaths / r.runs).toFixed(2) : '—'}</td>
              <td className="py-1.5 text-right tabular-nums">
                {r.profit.runsWithLoot && r.profit.profitPerHour !== null ? money(r.profit.profitPerHour, { sign: true }) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-stone-500">A few sessions per version are needed before comparing.</p>
    </Card>
  )
}
