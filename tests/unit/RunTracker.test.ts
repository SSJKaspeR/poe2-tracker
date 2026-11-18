import { describe, expect, it } from 'vitest'
import { parseLine } from '@core/logs/parseLine'
import { RunTracker, type RunTrackerEvent } from '@core/runs/RunTracker'

function line(min: number, sec: number, msg: string): string {
  const mm = String(min).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return `2026/11/18 20:${mm}:${ss} 1000 abcdef12 [INFO Client 1] ${msg}`
}
const gen = (m: number, s: number, id: string, seed: number, lvl = 79) =>
  line(m, s, `Generating level ${lvl} area "${id}" with seed ${seed}`)

function feed(tracker: RunTracker, lines: string[]): RunTrackerEvent[] {
  const events: RunTrackerEvent[] = []
  tracker.on((e) => events.push(e))
  for (const l of lines) {
    const e = parseLine(l)
    if (e) tracker.handle(e)
  }
  return events
}

let n = 0
const ids = () => `r${++n}`

describe('RunTracker', () => {
  it('tracks a simple run: hideout → map → hideout → next map', () => {
    n = 0
    const t = new RunTracker({ idFactory: ids })
    const events = feed(t, [
      gen(0, 0, 'HideoutBattleground', 1),
      line(1, 0, 'Connecting to instance server at 10.0.0.1:6112'),
      gen(1, 1, 'MapCrypt', 111),
      line(1, 2, ': You have entered Crypt.'),
      line(4, 0, ': Kasper has been slain.'),
      gen(6, 1, 'HideoutBattleground', 1),
      gen(7, 0, 'MapSavanna', 222),
      line(7, 1, ': You have entered Savanna.')
    ])

    const completed = events.filter((e) => e.type === 'run_completed')
    expect(completed).toHaveLength(1)
    const run = completed[0]!.type === 'run_completed' ? completed[0]!.run : null
    expect(run).toMatchObject({ id: 'r1', areaId: 'MapCrypt', areaName: 'Crypt', deaths: 1, instanceIp: '10.0.0.1' })
    // Active time: 20:01:01 → 20:06:01 = 5 min. Hideout time (06:01 → 07:00) excluded.
    expect(run!.activeMs).toBe(5 * 60_000)
    expect(run!.endedAt).toEqual(new Date(2026, 10, 18, 20, 6, 1))
    expect(t.getState()).toBe('running')
    expect(t.getCurrentRun()).toMatchObject({ id: 'r2', areaName: 'Savanna' })
  })

  it('resumes the same instance after a portal to hideout', () => {
    n = 0
    const t = new RunTracker({ idFactory: ids })
    const events = feed(t, [
      gen(0, 0, 'MapCrypt', 111),
      gen(2, 0, 'HideoutBattleground', 1),
      gen(3, 0, 'MapCrypt', 111),
      gen(5, 0, 'HideoutBattleground', 1)
    ])
    expect(events.map((e) => e.type)).toEqual(['run_started', 'run_paused', 'run_resumed', 'run_paused'])
    const run = t.getCurrentRun()!
    expect(run.reentries).toBe(1)
    expect(run.activeMs).toBe(4 * 60_000) // 2 min + 2 min
    expect(t.getState()).toBe('pending_end')
  })

  it('treats the same area with a new seed as a new run', () => {
    n = 0
    const t = new RunTracker({ idFactory: ids })
    const events = feed(t, [gen(0, 0, 'MapCrypt', 111), gen(1, 0, 'HideoutBattleground', 1), gen(2, 0, 'MapCrypt', 999)])
    expect(events.filter((e) => e.type === 'run_completed')).toHaveLength(1)
    expect(t.getCurrentRun()?.seed).toBe(999)
  })

  it('closes a paused run after the timeout', () => {
    n = 0
    const t = new RunTracker({ idFactory: ids, pendingTimeoutMs: 10 * 60_000 })
    const events = feed(t, [gen(0, 0, 'MapCrypt', 111), gen(3, 0, 'HideoutBattleground', 1)])
    t.tick(new Date(2026, 10, 18, 20, 12, 59))
    expect(t.getState()).toBe('pending_end')
    t.tick(new Date(2026, 10, 18, 20, 13, 0))
    expect(t.getState()).toBe('idle')
    const done = events.find((e) => e.type === 'run_completed')
    expect(done).toMatchObject({ reason: 'timeout' })
    if (done?.type === 'run_completed') {
      expect(done.run.endedAt).toEqual(new Date(2026, 10, 18, 20, 3, 0))
      expect(done.run.activeMs).toBe(3 * 60_000)
    }
  })

  it('closes the run when the game restarts', () => {
    n = 0
    const t = new RunTracker({ idFactory: ids })
    const events = feed(t, [gen(0, 0, 'MapCrypt', 111), '2026/11/18 20:05:00 ***** LOG FILE OPENING *****'])
    expect(events.at(-1)).toMatchObject({ type: 'run_completed', reason: 'game_restart' })
  })

  it('only counts deaths of the configured character', () => {
    n = 0
    const t = new RunTracker({ idFactory: ids, characterNames: ['Kasper'] })
    feed(t, [gen(0, 0, 'MapCrypt', 111), line(1, 0, ': PartyMember has been slain.'), line(2, 0, ': kasper has been slain.')])
    expect(t.getCurrentRun()?.deaths).toBe(1)
  })

  it('ignores campaign zones when idle and ends a run when entering one', () => {
    n = 0
    const t = new RunTracker({ idFactory: ids })
    const events = feed(t, [gen(0, 0, 'G1_1', 5, 1), gen(1, 0, 'MapCrypt', 111), gen(2, 0, 'G1_2', 6, 2)])
    expect(events.map((e) => e.type)).toEqual(['run_started', 'run_completed'])
    expect(t.getState()).toBe('idle')
  })

  it('manual end uses the time the player left the map', () => {
    n = 0
    const t = new RunTracker({ idFactory: ids })
    feed(t, [gen(0, 0, 'MapCrypt', 111), gen(4, 0, 'HideoutBattleground', 1)])
    const run = t.endCurrentRun(new Date(2026, 10, 18, 20, 8, 0))
    expect(run?.endedAt).toEqual(new Date(2026, 10, 18, 20, 4, 0))
    expect(run?.activeMs).toBe(4 * 60_000)
  })
})

describe('RunTracker in boss mode', () => {
  it('tracks unknown arenas as runs and resumes them like maps', () => {
    n = 0
    const t = new RunTracker({ idFactory: ids, trackOtherAreas: true })
    const events = feed(t, [
      gen(0, 0, 'HideoutBattleground', 1),
      gen(1, 0, 'PinnacleArbiterArena', 42, 82),
      gen(3, 0, 'HideoutBattleground', 1),
      gen(4, 0, 'PinnacleArbiterArena', 42, 82),
      gen(6, 0, 'PinnacleArbiterArena', 43, 82)
    ])
    expect(events.map((e) => e.type)).toEqual(['run_started', 'run_paused', 'run_resumed', 'run_completed', 'run_started'])
    const done = events.find((e) => e.type === 'run_completed')
    if (done?.type === 'run_completed') expect(done.run.activeMs).toBe(4 * 60_000)
  })

  it('can be switched on and off', () => {
    n = 0
    const t = new RunTracker({ idFactory: ids })
    feed(t, [gen(0, 0, 'PinnacleArbiterArena', 42)])
    expect(t.getState()).toBe('idle')
    t.setTrackOtherAreas(true)
    feed(t, [gen(1, 0, 'PinnacleArbiterArena', 43)])
    expect(t.getState()).toBe('running')
  })
})
