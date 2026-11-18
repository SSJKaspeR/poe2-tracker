import type { DatabaseSync } from 'node:sqlite'
import type { PriceBook } from '../pricing/PriceBook'

/**
 * Declarative investment & loot. The player declares, the app prices and computes.
 * All values are stored in the primary currency (Divine Orb) at declaration time,
 * so later price moves don't rewrite history.
 */

export type InvestmentKind = 'waystone' | 'tablet' | 'currency' | 'other'

export interface PresetItem {
  kind: InvestmentKind
  label: string
  /** poe.ninja id or item name used for pricing. */
  itemId?: string
  quantity: number
  /** Per-unit value in Divine when the item has no market price (e.g. waystones). */
  manualValue?: number
}

export interface StrategyPreset {
  id: number
  name: string
  items: PresetItem[]
}

export interface DeclaredLine {
  id: number
  runId: string
  label: string
  itemId: string | null
  quantity: number
  unitValue: number | null
  kind?: InvestmentKind
}

export interface ProfitSummary {
  runs: number
  activeMs: number
  invested: number
  looted: number
  profit: number
  /** Profit per hour of time spent in maps. Null when no time recorded. */
  profitPerHour: number | null
  /** Runs with no loot declared are excluded from loot/profit averages. */
  runsWithLoot: number
  currency: string
}

export class Economy {
  constructor(
    private readonly db: DatabaseSync,
    private readonly prices: () => PriceBook,
    private readonly primaryCurrency = 'divine'
  ) {}

  // ── Presets ────────────────────────────────────────────────────────────────

  createPreset(name: string, items: PresetItem[], now = new Date()): StrategyPreset {
    const r = this.db
      .prepare('INSERT INTO strategy_presets (name, items_json, created_at) VALUES (?, ?, ?)')
      .run(name, JSON.stringify(items), now.toISOString())
    return { id: Number(r.lastInsertRowid), name, items }
  }

  updatePreset(id: number, name: string, items: PresetItem[]): void {
    this.db.prepare('UPDATE strategy_presets SET name = ?, items_json = ? WHERE id = ?').run(name, JSON.stringify(items), id)
  }

  deletePreset(id: number): void {
    this.db.prepare('UPDATE runs SET strategy_id = NULL WHERE strategy_id = ?').run(id)
    this.db.prepare('DELETE FROM strategy_presets WHERE id = ?').run(id)
  }

  presets(): StrategyPreset[] {
    const rows = this.db.prepare('SELECT id, name, items_json FROM strategy_presets ORDER BY id').all() as unknown as {
      id: number
      name: string
      items_json: string
    }[]
    return rows.map((r) => ({ id: r.id, name: r.name, items: JSON.parse(r.items_json) as PresetItem[] }))
  }

  getPreset(id: number): StrategyPreset | null {
    return this.presets().find((p) => p.id === id) ?? null
  }

  /** Per-map cost of a preset at current prices. Items with no price and no manual value count as 0. */
  presetCost(preset: StrategyPreset): { total: number; unpriced: string[] } {
    let total = 0
    const unpriced: string[] = []
    for (const it of preset.items) {
      const unit = this.unitValue(it.itemId ?? it.label, it.manualValue)
      if (unit === null) unpriced.push(it.label)
      else total += unit * it.quantity
    }
    return { total, unpriced }
  }

  // ── Per-run declarations ──────────────────────────────────────────────────

  /** Replace the run's investment with the preset's items (priced now). */
  applyPreset(runId: string, presetId: number): void {
    const preset = this.getPreset(presetId)
    if (!preset) throw new Error(`unknown preset ${presetId}`)
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM run_investments WHERE run_id = ?').run(runId)
      for (const it of preset.items) {
        this.insertInvestment(runId, it)
      }
      this.db.prepare('UPDATE runs SET strategy_id = ? WHERE id = ?').run(presetId, runId)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  addInvestment(runId: string, item: PresetItem): void {
    this.insertInvestment(runId, item)
  }

  addLoot(runId: string, item: { label: string; itemId?: string; quantity: number; manualValue?: number }): void {
    const unit = this.unitValue(item.itemId ?? item.label, item.manualValue)
    this.db
      .prepare('INSERT INTO run_loot (run_id, item_id, label, quantity, unit_value, currency) VALUES (?, ?, ?, ?, ?, ?)')
      .run(runId, item.itemId ?? null, item.label, item.quantity, unit, this.primaryCurrency)
  }

  removeLoot(lineId: number): void {
    this.db.prepare('DELETE FROM run_loot WHERE id = ?').run(lineId)
  }

  removeInvestment(lineId: number): void {
    this.db.prepare('DELETE FROM run_investments WHERE id = ?').run(lineId)
  }

  runLines(runId: string): { investments: DeclaredLine[]; loot: DeclaredLine[]; strategyId: number | null } {
    const inv = this.db
      .prepare('SELECT id, run_id, kind, label, item_id, quantity, unit_value FROM run_investments WHERE run_id = ? ORDER BY id')
      .all(runId) as unknown as LineRow[]
    const loot = this.db
      .prepare('SELECT id, run_id, label, item_id, quantity, unit_value FROM run_loot WHERE run_id = ? ORDER BY id')
      .all(runId) as unknown as LineRow[]
    const run = this.db.prepare('SELECT strategy_id FROM runs WHERE id = ?').get(runId) as
      | { strategy_id: number | null }
      | undefined
    return { investments: inv.map(toLine), loot: loot.map(toLine), strategyId: run?.strategy_id ?? null }
  }

  // ── Totals ────────────────────────────────────────────────────────────────

  /** Profit over completed runs, optionally filtered by start date, strategy or build version. */
  summary(filter: { since?: Date; strategyId?: number; buildVersionId?: number } = {}): ProfitSummary {
    const where = ['r.ended_at IS NOT NULL']
    const params: (string | number)[] = []
    if (filter.since) {
      where.push('r.started_at >= ?')
      params.push(filter.since.toISOString())
    }
    if (filter.strategyId !== undefined) {
      where.push('r.strategy_id = ?')
      params.push(filter.strategyId)
    }
    if (filter.buildVersionId !== undefined) {
      where.push('r.build_version_id = ?')
      params.push(filter.buildVersionId)
    }
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS runs,
                COALESCE(SUM(r.active_ms), 0) AS active_ms,
                COALESCE(SUM((SELECT SUM(quantity * COALESCE(unit_value, 0)) FROM run_investments i WHERE i.run_id = r.id)), 0) AS invested,
                COALESCE(SUM((SELECT SUM(quantity * COALESCE(unit_value, 0)) FROM run_loot l WHERE l.run_id = r.id)), 0) AS looted,
                COALESCE(SUM(EXISTS (SELECT 1 FROM run_loot l WHERE l.run_id = r.id)), 0) AS runs_with_loot
         FROM runs r WHERE ${where.join(' AND ')}`
      )
      .get(...params) as { runs: number; active_ms: number; invested: number; looted: number; runs_with_loot: number }

    const profit = row.looted - row.invested
    return {
      runs: row.runs,
      activeMs: row.active_ms,
      invested: row.invested,
      looted: row.looted,
      profit,
      profitPerHour: row.active_ms > 0 ? (profit / row.active_ms) * 3_600_000 : null,
      runsWithLoot: row.runs_with_loot,
      currency: this.primaryCurrency
    }
  }

  private insertInvestment(runId: string, it: PresetItem): void {
    const unit = this.unitValue(it.itemId ?? it.label, it.manualValue)
    this.db
      .prepare(
        'INSERT INTO run_investments (run_id, kind, item_id, label, quantity, unit_value, currency) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(runId, it.kind, it.itemId ?? null, it.label, it.quantity, unit, this.primaryCurrency)
  }

  private unitValue(idOrName: string, manual?: number): number | null {
    if (manual !== undefined && manual !== null) return manual
    const p = this.prices().get(idOrName)
    return p ? p.value : null
  }
}

interface LineRow {
  id: number
  run_id: string
  kind?: InvestmentKind
  label: string
  item_id: string | null
  quantity: number
  unit_value: number | null
}

function toLine(r: LineRow): DeclaredLine {
  return {
    id: r.id,
    runId: r.run_id,
    label: r.label,
    itemId: r.item_id,
    quantity: r.quantity,
    unitValue: r.unit_value,
    ...(r.kind ? { kind: r.kind } : {})
  }
}
