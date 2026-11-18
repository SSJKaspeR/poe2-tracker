import { useState } from 'react'
import type { BuildSnapshotDTO, ItemComparisonDTO } from '@shared/ipc'
import { STAT_LABELS, formatStat, isImprovement } from '../format'
import { useTracker } from '../store'
import { Button, Card } from './Card'

const KEY_STATS = ['CombinedDPS', 'Life', 'EnergyShield', 'Spirit', 'TotalEHP', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist']

export function BuildPanel() {
  const pob = useTracker((s) => s.status?.pob)
  const [code, setCode] = useState('')
  const [build, setBuild] = useState<BuildSnapshotDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const ready = pob?.available && pob.running

  async function importBuild() {
    setBusy(true)
    setError(null)
    const res = await window.tracker.importBuild(code)
    setBusy(false)
    if (res.ok) {
      setBuild(res.value)
      setCode('')
    } else setError(res.error)
  }

  return (
    <Card title="Build" actions={<EngineBadge />}>
      {build ? (
        <div className="mb-3">
          <div className="text-stone-100">
            {build.info.ascendancy && build.info.ascendancy !== 'None' ? build.info.ascendancy : build.info.className} · level{' '}
            {build.info.level}
            {build.info.mainSkill ? ` · ${build.info.mainSkill}` : ''}
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 text-sm">
            {KEY_STATS.filter((k) => build.stats[k] !== undefined).map((k) => (
              <div key={k} className="flex justify-between">
                <dt className="text-stone-500">{STAT_LABELS[k] ?? k}</dt>
                <dd className="tabular-nums">{formatStat(k, build.stats[k]!)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <p className="mb-3 text-sm text-stone-500">Paste your Path of Building code once — the app keeps it up to date.</p>
      )}
      <textarea
        className="h-16 w-full resize-none rounded-md border border-stone-800 bg-stone-950 p-2 font-mono text-xs text-stone-300 outline-none focus:border-ember-500"
        placeholder="PoB code (eNrt…)"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <div className="mt-2 flex items-center gap-3">
        <Button onClick={() => void importBuild()} disabled={!ready || busy || code.trim().length < 20}>
          {busy ? 'Importing…' : 'Import build'}
        </Button>
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
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
  const pob = useTracker((s) => s.status?.pob)
  const [text, setText] = useState('')
  const [result, setResult] = useState<ItemComparisonDTO | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function compare(itemText: string) {
    setError(null)
    const res = await window.tracker.compareItem(itemText)
    if (res.ok) setResult(res.value)
    else {
      setResult(null)
      setError(res.error)
    }
  }

  const changes = result
    ? Object.entries(result.diff)
        .filter(([k]) => STAT_LABELS[k])
        .sort(([a], [b]) => Object.keys(STAT_LABELS).indexOf(a) - Object.keys(STAT_LABELS).indexOf(b))
    : []

  return (
    <Card title="Compare an item">
      <textarea
        className="h-28 w-full resize-none rounded-md border border-stone-800 bg-stone-950 p-2 font-mono text-xs text-stone-300 outline-none focus:border-ember-500"
        placeholder="Hover an item in game, press Ctrl+C, paste it here"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text')
          if (pasted.includes('Rarity:')) void compare(pasted)
        }}
      />
      <div className="mt-2 flex items-center gap-3">
        <Button onClick={() => void compare(text)} disabled={!pob?.running || text.trim().length === 0}>
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
                    <span className={isImprovement(k, c.delta) ? 'text-emerald-400' : 'text-red-400'}>
                      {formatStat(k, c.after)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}
