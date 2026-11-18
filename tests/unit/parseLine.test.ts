import { describe, expect, it } from 'vitest'
import { parseLine } from '@core/logs/parseLine'

const P = '2026/11/18 17:40:12 123456789 1186a8e1 [DEBUG Client 23728] '
const I = '2026/11/18 17:40:12 123456789 cff945bb [INFO Client 23728] '

describe('parseLine', () => {
  it('parses area generation', () => {
    const e = parseLine(`${P}Generating level 79 area "MapCrypt" with seed 2915893134`)
    expect(e).toMatchObject({ type: 'area_generated', areaId: 'MapCrypt', areaLevel: 79, seed: 2915893134 })
    expect(e?.time).toEqual(new Date(2026, 10, 18, 17, 40, 12))
  })

  it('parses hideout generation (real PoE log sample)', () => {
    const e = parseLine(
      '2025/11/11 17:31:37 10811171 1186a8e1 [DEBUG Client 23728] Generating level 60 area "HideoutBattleground" with seed 1'
    )
    expect(e).toMatchObject({ type: 'area_generated', areaId: 'HideoutBattleground', seed: 1 })
  })

  it('parses instance connection', () => {
    expect(parseLine(`${I}Connecting to instance server at 159.255.5.21:6112`)).toMatchObject({
      type: 'instance_connect',
      ip: '159.255.5.21',
      port: 6112
    })
  })

  it('parses area entered', () => {
    expect(parseLine(`${I}: You have entered Crypt.`)).toMatchObject({ type: 'area_entered', areaName: 'Crypt' })
  })

  it('parses deaths and level ups', () => {
    expect(parseLine(`${I}: KasperDuelist has been slain.`)).toMatchObject({ type: 'player_slain', name: 'KasperDuelist' })
    expect(parseLine(`${I}: KasperDuelist (Duelist) is now level 92`)).toMatchObject({
      type: 'level_up',
      name: 'KasperDuelist',
      className: 'Duelist',
      level: 92
    })
  })

  it('parses whispers with and without direction', () => {
    expect(parseLine(`${I}@From <GUILD> Buyer: Hi, I would like to buy your Divine Orb`)).toMatchObject({
      type: 'whisper',
      direction: 'from',
      name: 'Buyer'
    })
    expect(parseLine(`${I}@To Seller: Hi, I would like to buy`)).toMatchObject({ direction: 'to', name: 'Seller' })
    expect(parseLine(`${I}@Someone: hello`)).toMatchObject({ direction: 'unknown', name: 'Someone', message: 'hello' })
  })

  it('parses log opening and AFK', () => {
    expect(parseLine('2026/11/18 17:00:00 ***** LOG FILE OPENING *****')).toMatchObject({ type: 'log_opened' })
    expect(parseLine(`${I}: AFK mode is now ON. Autoreply "This player is AFK."`)).toMatchObject({ type: 'afk', on: true })
  })

  it('ignores unrelated lines and handles CRLF', () => {
    expect(parseLine(`${I}Tile hash: 3713433821`)).toBeNull()
    expect(parseLine('garbage')).toBeNull()
    expect(parseLine(`${I}: You have entered Hideout.\r`)).toMatchObject({ areaName: 'Hideout' })
  })
})
