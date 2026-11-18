/**
 * Client.txt line parser for Path of Exile 2.
 *
 * Line layout (shared by PoE 1 and PoE 2):
 *   2026/11/18 17:40:12 123456789 1186a8e1 [DEBUG Client 23728] Generating level 65 area "MapCrypt" with seed 2915893134
 *   └─ local time ─────┘ └ uptime ┘ └ hash ┘ └ level + pid ───┘ └ message ─────────────────────────────────────────────┘
 *
 * ⚠️ Patterns marked "to verify on 1.0" must be re-checked against a real
 * 1.0 log on December 11.
 */

export type LogEvent =
  | { type: 'log_opened'; time: Date }
  | { type: 'instance_connect'; time: Date; ip: string; port: number }
  | { type: 'area_generated'; time: Date; areaId: string; areaLevel: number; seed: number }
  | { type: 'area_entered'; time: Date; areaName: string }
  | { type: 'player_slain'; time: Date; name: string }
  | { type: 'level_up'; time: Date; name: string; className: string; level: number }
  | { type: 'whisper'; time: Date; direction: 'from' | 'to' | 'unknown'; name: string; message: string }
  | { type: 'afk'; time: Date; on: boolean }

const LINE_RE = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) \d+ [0-9a-f]+ \[\w+ Client \d+\] (.*)$/
const LOG_OPEN_RE = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) \*{5} LOG FILE OPENING \*{5}/

const GENERATING_RE = /^Generating level (\d+) area "([^"]+)" with seed (\d+)/
const CONNECT_RE = /^Connecting to instance server at ([0-9a-fA-F.:]+?):(\d+)\s*$/
const ENTERED_RE = /^: You have entered (.+?)\.?\s*$/
const SLAIN_RE = /^: (.+) has been slain\.\s*$/
const LEVEL_UP_RE = /^: (.+) \(([^)]+)\) is now level (\d+)\s*$/
// to verify on 1.0: early access logged "@User: msg" without From/To.
const WHISPER_DIRECTED_RE = /^@(From|To) (?:<[^>]*> )?([^:]+): (.*)$/
const WHISPER_BARE_RE = /^@(?:<[^>]*> )?([^:\s][^:]*): (.*)$/
const AFK_RE = /^: AFK mode is now (ON|OFF)/

function toDate(m: RegExpMatchArray): Date {
  // Client.txt timestamps are local time without a zone.
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6])
  )
}

export function parseLine(raw: string): LogEvent | null {
  const line = raw.replace(/\r$/, '')

  const open = LOG_OPEN_RE.exec(line)
  if (open) return { type: 'log_opened', time: toDate(open) }

  const m = LINE_RE.exec(line)
  if (!m) return null
  const time = toDate(m)
  const msg = m[7] ?? ''

  let r: RegExpExecArray | null

  if ((r = GENERATING_RE.exec(msg))) {
    return { type: 'area_generated', time, areaLevel: Number(r[1]), areaId: r[2]!, seed: Number(r[3]) }
  }
  if ((r = CONNECT_RE.exec(msg))) {
    return { type: 'instance_connect', time, ip: r[1]!, port: Number(r[2]) }
  }
  if ((r = ENTERED_RE.exec(msg))) {
    return { type: 'area_entered', time, areaName: r[1]! }
  }
  if ((r = SLAIN_RE.exec(msg))) {
    return { type: 'player_slain', time, name: r[1]! }
  }
  if ((r = LEVEL_UP_RE.exec(msg))) {
    return { type: 'level_up', time, name: r[1]!, className: r[2]!, level: Number(r[3]) }
  }
  if ((r = AFK_RE.exec(msg))) {
    return { type: 'afk', time, on: r[1] === 'ON' }
  }
  if ((r = WHISPER_DIRECTED_RE.exec(msg))) {
    return {
      type: 'whisper',
      time,
      direction: r[1] === 'From' ? 'from' : 'to',
      name: r[2]!.trim(),
      message: r[3]!
    }
  }
  if ((r = WHISPER_BARE_RE.exec(msg))) {
    return { type: 'whisper', time, direction: 'unknown', name: r[1]!.trim(), message: r[2]! }
  }
  return null
}
