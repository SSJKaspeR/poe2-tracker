import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '@core/db/Database'
import { RunRepository } from '@core/db/RunRepository'
import { PriceBook } from '@core/pricing/PriceBook'
import type { Run } from '@core/runs/RunTracker'
import { SessionRepository } from '@core/sessions/SessionRepository'

const prices = new PriceBook([
  { id: 'divine', name: 'Divine Orb', value: 1, currency: 'divine' },
  { id: 'exalted', name: 'Exalted Orb', value: 0.002, currency: 'divine' }
])

const T0 = new Date('2026-11-18T19:00:00Z')
const at = (min: number) => new Date(T0.getTime() + min * 60_000)

function run(id: string, startMin: number, activeMin: number, ended = true): Run {
  return {
    id, areaId: 'MapCrypt', areaName: 'Crypt', areaLevel: 80, seed: 1, instanceIp: null,
    startedAt: at(startMin), endedAt: ended ? at(startMin + activeMin) : null,
    activeMs: activeMin * 60_000, deaths: 0, reentries: 0
  }
}

describe('SessionRepository', () => {
  let db: AppDatabase
  let runs: RunRepository
  let sessions: SessionRepository

  beforeEach(() => {
    db = new AppDatabase(':memory:')
    runs = new RunRepository(db.db)
    sessions = new SessionRepository(db.db, () => prices)
  })

  it('rush maps: progress, objective and profit per hour over the whole session', () => {
    const s = sessions.start({ mode: 'maps', targetCount: 2 }, T0)
    runs.upsert(run('a', 1, 5))
    runs.upsert(run('b', 8, 5))
    sessions.attachRun('a', s.id, 'map')
    sessions.attachRun('b', s.id, 'map')
    db.db.prepare("INSERT INTO run_investments (run_id, kind, label, quantity, unit_value) VALUES ('a', 'waystone', 'W', 1, 0.5), ('b', 'waystone', 'W', 1, 0.5)").run()
    db.db.prepare("INSERT INTO run_loot (run_id, label, quantity, unit_value) VALUES ('a', 'Divine Orb', 3, 1)").run()

    const sum = sessions.summary(s.id, at(15))!
    expect(sum.completedRuns).toBe(2)
    expect(sum.objectiveReached).toBe(true)
    expect(sum.runActiveMs).toBe(10 * 60_000)
    expect(sum.durationMs).toBe(15 * 60_000)
    expect(sum.profit).toBeCloseTo(2)
    // 2 div over 15 min of session (not 10 min of maps) = 8 div/h
    expect(sum.profitPerHour).toBeCloseTo(8)
  })

  it('boss: kills and fails count as attempts', () => {
    const s = sessions.start({ mode: 'boss', bossName: 'Arbiter of Ash', targetCount: 3 }, T0)
    for (const id of ['a', 'b', 'c']) {
      runs.upsert(run(id, 1, 2))
      sessions.attachRun(id, s.id, 'boss')
    }
    sessions.setOutcome('a', 'kill')
    sessions.setOutcome('b', 'fail')
    let sum = sessions.summary(s.id, at(10))!
    expect([sum.kills, sum.fails, sum.objectiveReached]).toEqual([1, 1, false])
    sessions.setOutcome('c', 'kill')
    sum = sessions.summary(s.id, at(10))!
    expect([sum.kills, sum.objectiveReached]).toEqual([2, true])
    expect(db.db.prepare("SELECT kind FROM runs WHERE id = 'a'").get()).toEqual({ kind: 'boss' })
  })

  it('hideout: craft lines priced by name or manual value', () => {
    const s = sessions.start({ mode: 'hideout', activity: 'craft' }, T0)
    sessions.addLine(s.id, { direction: 'spent', label: 'Exalted Orb', quantity: 50 })
    sessions.addLine(s.id, { direction: 'gained', label: 'Sold ring', quantity: 1, manualValue: 2 })
    const sum = sessions.summary(s.id, at(30))!
    expect(sum.spent).toBeCloseTo(0.1)
    expect(sum.gained).toBe(2)
    expect(sum.profit).toBeCloseTo(1.9)
    expect(sum.profitPerHour).toBeCloseTo(3.8)
    expect(sessions.lines(s.id)).toHaveLength(2)
  })

  it('does not compute a rate for sessions under 5 minutes', () => {
    const s = sessions.start({ mode: 'hideout', activity: 'craft' }, T0)
    sessions.addLine(s.id, { direction: 'gained', label: 'Sale', quantity: 1, manualValue: 1 })
    expect(sessions.summary(s.id, at(4))!.profitPerHour).toBeNull()
    expect(sessions.summary(s.id, at(5))!.profitPerHour).toBeCloseTo(12)
  })

  it('starting a session ends the previous one; a run joins only one session', () => {
    const a = sessions.start({ mode: 'maps', targetCount: 10 }, T0)
    const b = sessions.start({ mode: 'hideout', activity: 'stash' }, at(20))
    expect(sessions.get(a.id)!.endedAt).toEqual(at(20))
    expect(sessions.active()?.id).toBe(b.id)
    runs.upsert(run('x', 21, 1))
    sessions.attachRun('x', b.id, 'map')
    sessions.attachRun('x', a.id, 'boss')
    expect(db.db.prepare("SELECT session_id, kind FROM runs WHERE id = 'x'").get()).toEqual({ session_id: b.id, kind: 'map' })
    sessions.end(b.id, at(30))
    expect(sessions.active()).toBeNull()
    expect(sessions.summary(b.id, at(99))!.durationMs).toBe(10 * 60_000)
  })
})
