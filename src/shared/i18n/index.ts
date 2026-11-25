/**
 * Translations. Texts are written in English in the code and wrapped in `t('…')`;
 * the French dictionary maps each English text to its translation. A missing translation
 * falls back to English (a unit test lists every `t('…')` text without a French entry).
 *
 * Parameters use {name}: t('{n} maps', { n: 3 }).
 */
import { FR } from './fr'

export type Lang = 'en' | 'fr'
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' }
]

export type Translator = (text: string, params?: Record<string, string | number>) => string

function fill(text: string, params?: Record<string, string | number>): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

export function translator(lang: Lang): Translator {
  const dict: Record<string, string> | null = lang === 'fr' ? FR : null
  return (text, params) => fill(dict?.[text] ?? text, params)
}

/** English, the language the texts are written in. */
export const en: Translator = translator('en')

/** App language from a system locale ("fr-FR" → fr), English otherwise. */
export function langFromLocale(locale: string | null | undefined): Lang {
  return /^fr\b/i.test(locale ?? '') ? 'fr' : 'en'
}

export function isLang(x: unknown): x is Lang {
  return x === 'en' || x === 'fr'
}
