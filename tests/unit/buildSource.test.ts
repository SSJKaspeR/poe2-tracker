import { describe, expect, it, vi } from 'vitest'
import { parseBuildSource, resolveBuildCode } from '@core/pob/buildSource'

const CODE = 'eNrtfWuP4ziS4OfrX0HUhxsCaq6Q81Jl9dZgu9rB7cvqqs3qrhn0HBYC7bRtunK8kEg3o-ab7gXcz_5k'

describe('build import: code or link', () => {
  it('recognises the same sites as Path of Building', () => {
    expect(parseBuildSource('https://pobb.in/AbC-12_x')).toEqual({ kind: 'link', site: 'pobb.in', url: 'https://pobb.in/pob/AbC-12_x' })
    expect(parseBuildSource('  https://poe.ninja/poe2/pob/1a2b3  ')).toEqual({
      kind: 'link',
      site: 'poe.ninja',
      url: 'https://poe.ninja/poe2/pob/raw/1a2b3'
    })
    expect(parseBuildSource('https://poe2.ninja/pob/zz9')).toMatchObject({ site: 'poe.ninja', url: 'https://poe.ninja/poe2/pob/raw/zz9' })
    expect(parseBuildSource('https://maxroll.gg/poe2/pob/k3j4')).toMatchObject({ url: 'https://maxroll.gg/poe2/api/pob/k3j4' })
    expect(parseBuildSource('https://poe2db.tw/pob/q1')).toMatchObject({ url: 'https://poe2db.tw/pob/q1/raw' })
    expect(parseBuildSource('https://pastebin.com/Xy12')).toMatchObject({ url: 'https://pastebin.com/raw/Xy12' })
  })

  it('accepts a code with line breaks, rejects anything else', () => {
    expect(parseBuildSource(`${CODE.slice(0, 40)}\n${CODE.slice(40)}\n`)).toEqual({ kind: 'code', code: CODE })
    expect(parseBuildSource('https://www.pathofexile.com/trade2/search/poe2/Standard')).toEqual({ kind: 'unknown' })
    expect(parseBuildSource('hello')).toEqual({ kind: 'unknown' })
  })

  it('downloads a link once, and explains failures', async () => {
    const fetchText = vi.fn(async () => `${CODE}\n`)
    expect(await resolveBuildCode('https://pobb.in/abc', fetchText)).toBe(CODE)
    expect(fetchText).toHaveBeenCalledExactlyOnceWith('https://pobb.in/pob/abc')
    expect(await resolveBuildCode(CODE, fetchText)).toBe(CODE)
    expect(fetchText).toHaveBeenCalledTimes(1) // a code needs no download

    await expect(resolveBuildCode('nope', fetchText)).rejects.toThrow(/Not a PoB code or a supported link/)
    await expect(resolveBuildCode('https://pobb.in/abc', async () => '<html>Not found</html>')).rejects.toThrow(
      'pobb.in did not return a PoB code (link expired or private?)'
    )
    await expect(
      resolveBuildCode('https://poe.ninja/poe2/pob/x', async () => {
        throw new Error('timeout of 15000ms exceeded')
      })
    ).rejects.toThrow('Could not download the build from poe.ninja: timeout of 15000ms exceeded')
  })
})
