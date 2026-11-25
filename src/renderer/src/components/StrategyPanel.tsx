import { useState } from 'react'
import type { InvestmentKind, PresetDTO, PresetItemDTO } from '@shared/ipc'
import { useMoney, useT, useTracker } from '../store'
import type { Translator } from '@shared/i18n'
import { Button, Card } from './Card'
import { ItemPicker } from './ItemPicker'

function kinds(t: Translator): { value: InvestmentKind; label: string }[] {
  return [
    { value: 'waystone', label: t('Waystone') },
    { value: 'tablet', label: t('Tablet') },
    { value: 'currency', label: t('Currency') },
    { value: 'other', label: t('Other') }
  ]
}

/**
 * A strategy = what goes into each map (waystone + tablets + other). Set it up
 * once; it is applied to every new map automatically, or in one click.
 */
export function StrategyPanel() {
  const status = useTracker((s) => s.status)
  const presets = useTracker((s) => s.presets)
  const setPresets = useTracker((s) => s.setPresets)
  const setStatus = useTracker((s) => s.setStatus)
  const money = useMoney()
  const t = useT()
  const [editing, setEditing] = useState<{ id?: number; name: string; items: PresetItemDTO[] } | null>(null)

  if (!status) return null

  return (
    <Card
      title={t('Strategies')}
      actions={
        !editing && (
          <Button variant="ghost" onClick={() => setEditing({ name: '', items: [] })}>
            {t('New')}
          </Button>
        )
      }
    >
      {editing ? (
        <PresetEditor
          value={editing}
          onCancel={() => setEditing(null)}
          onSave={(p) =>
            void window.tracker.savePreset(p).then((list) => {
              setPresets(list)
              setEditing(null)
            })
          }
          onDelete={
            editing.id
              ? () =>
                  void window.tracker.deletePreset(editing.id!).then((list) => {
                    setPresets(list)
                    setEditing(null)
                  })
              : undefined
          }
        />
      ) : presets.length === 0 ? (
        <p className="text-sm text-stone-500">
          {t('Describe what you put in a map once (waystone, tablets…). Its cost is then counted on every run.')}
        </p>
      ) : (
        <>
          <ul className="space-y-1 text-sm">
            {presets.map((p) => (
              <PresetRow
                key={p.id}
                preset={p}
                active={status.activePresetId === p.id}
                cost={money(p.costPerMap)}
                onSelect={() =>
                  void window.tracker.setActivePreset(p.id, status.autoApplyPreset).then(setStatus)
                }
                onEdit={() => setEditing({ id: p.id, name: p.name, items: p.items })}
              />
            ))}
          </ul>
          <label className="mt-3 flex items-center gap-2 text-sm text-stone-400">
            <input
              type="checkbox"
              className="accent-amber-500"
              checked={status.autoApplyPreset}
              disabled={status.activePresetId === null}
              onChange={(e) =>
                void window.tracker.setActivePreset(status.activePresetId, e.target.checked).then(setStatus)
              }
            />
            {t('Apply the selected strategy to every new map')}
          </label>
        </>
      )}
    </Card>
  )
}

function PresetRow(props: {
  preset: PresetDTO
  active: boolean
  cost: string
  onSelect: () => void
  onEdit: () => void
}) {
  const { preset, active } = props
  const t = useT()
  return (
    <li className={`flex items-center justify-between rounded-md px-2 py-1 ${active ? 'bg-stone-800' : ''}`}>
      <button type="button" className="flex flex-1 items-center gap-2 text-left" onClick={props.onSelect}>
        <span className={active ? 'text-ember-400' : 'text-stone-600'}>{active ? '●' : '○'}</span>
        <span className="text-stone-200">{preset.name}</span>
        {preset.unpriced.length > 0 && (
          <span className="text-xs text-amber-500" title={t('No price for: {items}', { items: preset.unpriced.join(', ') })}>
            ⚠
          </span>
        )}
      </button>
      <span className="flex items-center gap-3">
        <span className="tabular-nums text-stone-400">{t('{cost} / map', { cost: props.cost })}</span>
        <button type="button" className="text-xs text-stone-500 hover:text-stone-200" onClick={props.onEdit}>
          {t('Edit')}
        </button>
      </span>
    </li>
  )
}

function PresetEditor(props: {
  value: { id?: number; name: string; items: PresetItemDTO[] }
  onSave: (p: { id?: number; name: string; items: PresetItemDTO[] }) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(props.value.name)
  const [items, setItems] = useState<PresetItemDTO[]>(props.value.items)
  const [kind, setKind] = useState<InvestmentKind>('waystone')
  const t = useT()
  const KINDS = kinds(t)

  return (
    <div className="space-y-3 text-sm">
      <input
        className="w-full rounded-md border border-stone-800 bg-stone-950 px-2 py-1 outline-none focus:border-ember-500"
        placeholder={t('Name (e.g. T15 Breach, 3 tablets)')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li key={i} className="flex justify-between">
              <span>
                <span className="text-stone-500">{KINDS.find((k) => k.value === it.kind)?.label}:</span> {it.quantity} ×{' '}
                {it.label}
                {it.manualValue !== undefined && <span className="text-stone-500"> @ {it.manualValue} div</span>}
              </span>
              <button
                type="button"
                className="text-stone-600 hover:text-red-400"
                aria-label={t('Remove {item}', { item: it.label })}
                onClick={() => setItems(items.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <select
          aria-label={t('Kind')}
          className="rounded-md border border-stone-800 bg-stone-950 px-1 py-1 outline-none"
          value={kind}
          onChange={(e) => setKind(e.target.value as InvestmentKind)}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <div className="flex-1">
          <ItemPicker onPick={(it) => setItems([...items, { kind, ...it }])} />
        </div>
      </div>
      <p className="text-xs text-stone-500">
        {t('Tablets have 10 charges: one tablet per map = quantity 0.1. Items without a market price need a value in div.')}
      </p>
      <div className="flex gap-2">
        <Button disabled={!name.trim() || items.length === 0} onClick={() => props.onSave({ id: props.value.id, name: name.trim(), items })}>
          {t('Save')}
        </Button>
        <Button variant="ghost" onClick={props.onCancel}>
          {t('Cancel')}
        </Button>
        {props.onDelete && (
          <button type="button" className="ml-auto text-xs text-red-400 hover:underline" onClick={props.onDelete}>
            {t('Delete')}
          </button>
        )}
      </div>
    </div>
  )
}
