import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { langFromLocale, translator } from '../../src/shared/i18n'
import { FR } from '../../src/shared/i18n/fr'
import { EXTRA_STAT_LABELS, STAT_HELP, STAT_LABELS } from '../../src/renderer/src/format'

const SRC = resolve(import.meta.dirname, '..', '..', 'src')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })
}

/** Every literal passed to t(…) / this.t(…) in the source code. */
function usedTexts(): Map<string, string> {
  const out = new Map<string, string>()
  const re = /\bt\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g
  for (const f of files(SRC)) {
    if (f.includes(`${join('shared', 'i18n')}`)) continue
    const src = readFileSync(f, 'utf8')
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      if (m[1] === '`' && m[2]!.includes('${')) continue // template literals must not be keys
      out.set(m[2]!.replace(/\\(['"`\\])/g, '$1'), f.replace(SRC, 'src'))
    }
  }
  // Stat names and help texts are translated through statLabel() / statHelp().
  for (const v of [...Object.values(STAT_LABELS), ...Object.values(EXTRA_STAT_LABELS), ...Object.values(STAT_HELP)]) {
    out.set(v, 'src/renderer/src/format.ts')
  }
  return out
}

describe('translations', () => {
  it('every interface text has a French translation', () => {
    const missing = [...usedTexts()].filter(([k]) => !(k in FR)).map(([k, f]) => `${f}: ${k}`)
    expect(missing).toEqual([])
  })

  it('French translations keep the same {parameters}', () => {
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const wrong = Object.entries(FR).filter(([en, fr]) => params(en).join() !== params(fr).join())
    expect(wrong).toEqual([])
  })

  it('no translation is left unused', () => {
    const used = usedTexts()
    expect(Object.keys(FR).filter((k) => !used.has(k))).toEqual([])
  })

  it('translator: parameters, fallback, system locale', () => {
    expect(translator('en')('{n} maps', { n: 3 })).toBe('3 maps')
    expect(translator('fr')('Not in the dictionary')).toBe('Not in the dictionary')
    expect(langFromLocale('fr-FR')).toBe('fr')
    expect(langFromLocale('fr')).toBe('fr')
    expect(langFromLocale('en-US')).toBe('en')
    expect(langFromLocale(undefined)).toBe('en')
  })
})

describe('generated texts follow the language', () => {
  it('impact lines and the comparison verdict', async () => {
    const { itemVerdict, summarizeImpact } = await import('../../src/shared/impact')
    const diff = { CombinedDPS: { before: 100, after: 120, delta: 20 }, FireResist: { before: 75, after: 60, delta: -15 } }
    const fr = translator('fr')
    const impact = summarizeImpact(diff, {}, fr)
    expect(impact.lines.map((l) => l.text)).toContain('+20% de dégâts')
    expect(impact.lines.some((l) => l.text.startsWith('Résistance au feu passe sous le cap'))).toBe(true)
    expect(itemVerdict(impact, 0.1, fr).text).toMatch(/^Déconseillé : Résistance au feu/)
    expect(itemVerdict(summarizeImpact(diff, {}), 0.1).text).toMatch(/^Not recommended: Fire resistance/)
  })

  it('gear check messages', async () => {
    const { checkItem } = await import('../../src/core/build/gearCheck')
    const item = { slot: 'Helmet', name: 'X', rarity: 'RARE', sockets: 1, runesFilled: 0, socketLimit: 1, affixLimit: 6, explicitLines: 6, quality: 20, maxQuality: 20, corrupted: false, mirrored: false }
    expect(checkItem(item as never, 10, translator('fr'))[0]!.message).toBe("1 châsse vide — ajoute une rune ou un cœur d'âme")
  })
})
