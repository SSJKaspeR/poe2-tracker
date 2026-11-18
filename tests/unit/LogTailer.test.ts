import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LogTailer } from '@core/logs/LogTailer'

const tailers: LogTailer[] = []
afterEach(async () => {
  await Promise.all(tailers.splice(0).map((t) => t.stop()))
})

function setup(initial = '') {
  const dir = mkdtempSync(join(tmpdir(), 'tailer-'))
  const file = join(dir, 'Client.txt')
  writeFileSync(file, initial)
  const lines: string[] = []
  return { file, lines }
}

describe('LogTailer', () => {
  it('starts at the end and emits only new complete lines', async () => {
    const { file, lines } = setup('old line\n')
    const t = new LogTailer(file, (l) => lines.push(l))
    tailers.push(t)
    await t.start()
    appendFileSync(file, 'first\r\nsecond\npart')
    await t.flush()
    expect(lines).toEqual(['first', 'second'])
    appendFileSync(file, 'ial\n')
    await t.flush()
    expect(lines).toEqual(['first', 'second', 'partial'])
  })

  it('restarts from the beginning when the file is truncated', async () => {
    const { file, lines } = setup('a long existing history line\n')
    const t = new LogTailer(file, (l) => lines.push(l))
    tailers.push(t)
    await t.start()
    writeFileSync(file, 'new\n')
    await t.flush()
    expect(lines).toEqual(['new'])
  })

  it('replays recent bytes without emitting a cut line', async () => {
    const { file, lines } = setup('0123456789 cut\nwhole line\n')
    const t = new LogTailer(file, (l) => lines.push(l), { replayBytes: 15 })
    tailers.push(t)
    await t.start()
    expect(lines).toEqual(['whole line'])
  })

  it('handles multi-byte characters split across reads', async () => {
    const { file, lines } = setup()
    const t = new LogTailer(file, (l) => lines.push(l))
    tailers.push(t)
    await t.start()
    const bytes = Buffer.from('Zoné ✓\n', 'utf8')
    appendFileSync(file, bytes.subarray(0, 4))
    await t.flush()
    appendFileSync(file, bytes.subarray(4))
    await t.flush()
    expect(lines).toEqual(['Zoné ✓'])
  })
})
