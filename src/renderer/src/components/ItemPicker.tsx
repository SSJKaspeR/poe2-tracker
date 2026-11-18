import { useEffect, useState } from 'react'
import type { PriceDTO } from '@shared/ipc'
import { useMoney } from '../store'

export interface PickedItem {
  label: string
  itemId?: string
  /** Manual per-unit value in Divine when the item has no market price. */
  manualValue?: number
  quantity: number
}

/**
 * Search box over poe.ninja prices. Unknown items can still be added with a
 * manual value (e.g. waystones, which poe.ninja may not price).
 */
export function ItemPicker({ onPick, submitLabel = 'Add' }: { onPick: (item: PickedItem) => void; submitLabel?: string }) {
  const money = useMoney()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PriceDTO[]>([])
  const [selected, setSelected] = useState<PriceDTO | null>(null)
  const [qty, setQty] = useState('1')
  const [manual, setManual] = useState('')

  useEffect(() => {
    if (selected || query.trim().length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    void window.tracker.searchPrices(query).then((r) => {
      if (!cancelled) setResults(r.slice(0, 6))
    })
    return () => {
      cancelled = true
    }
  }, [query, selected])

  const quantity = Number(qty.replace(',', '.'))
  const manualValue = manual.trim() ? Number(manual.replace(',', '.')) : undefined
  const valid = query.trim().length > 0 && quantity > 0 && (manualValue === undefined || manualValue >= 0)

  function submit() {
    if (!valid) return
    onPick({
      label: selected?.name ?? query.trim(),
      ...(selected ? { itemId: selected.id } : {}),
      ...(manualValue !== undefined ? { manualValue } : {}),
      quantity
    })
    setQuery('')
    setSelected(null)
    setQty('1')
    setManual('')
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-stone-800 bg-stone-950 px-2 py-1 text-sm outline-none focus:border-ember-500"
          placeholder="Item (Divine Orb, Breach Splinter…)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <input
          aria-label="Quantity"
          className="w-14 rounded-md border border-stone-800 bg-stone-950 px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-ember-500"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {!selected && (
          <input
            aria-label="Value in divine"
            title="Value per unit in Divine, if the item has no market price"
            className="w-20 rounded-md border border-stone-800 bg-stone-950 px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-ember-500"
            placeholder="div/u"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        )}
        <button
          type="button"
          className="rounded-md border border-stone-700 px-2 text-sm text-stone-200 hover:bg-stone-800 disabled:opacity-40"
          disabled={!valid}
          onClick={submit}
        >
          {submitLabel}
        </button>
      </div>
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-stone-700 bg-stone-900 text-sm shadow-xl">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full justify-between px-2 py-1 text-left hover:bg-stone-800"
                onClick={() => {
                  setSelected(p)
                  setQuery(p.name)
                  setResults([])
                }}
              >
                <span>{p.name}</span>
                <span className="tabular-nums text-stone-500">{money(p.value)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
