/**
 * What the player pasted to import a build: a PoB code, or a link from a build sharing
 * site (same list and raw-download addresses as Path of Building's own importer).
 * A link costs one download, only when the player clicks Import.
 */

export interface BuildSite {
  label: string
  match: RegExp
  raw: (id: string) => string
}

export const BUILD_SITES: BuildSite[] = [
  { label: 'pobb.in', match: /^https?:\/\/pobb\.in\/([\w-]+)\/?$/i, raw: (id) => `https://pobb.in/pob/${id}` },
  {
    label: 'poe.ninja',
    match: /^https?:\/\/poe2?\.ninja\/(?:poe2\/)?pob\/([\w-]+)\/?$/i,
    raw: (id) => `https://poe.ninja/poe2/pob/raw/${id}`
  },
  { label: 'Maxroll', match: /^https?:\/\/maxroll\.gg\/poe2\/pob\/([\w-]+)\/?$/i, raw: (id) => `https://maxroll.gg/poe2/api/pob/${id}` },
  { label: 'poe2db', match: /^https?:\/\/poe2db\.tw\/pob\/([\w-]+)\/?$/i, raw: (id) => `https://poe2db.tw/pob/${id}/raw` },
  { label: 'Pastebin', match: /^https?:\/\/pastebin\.com\/(\w+)\/?$/i, raw: (id) => `https://pastebin.com/raw/${id}` }
]

export type BuildSource =
  | { kind: 'code'; code: string }
  | { kind: 'link'; site: string; url: string }
  | { kind: 'unknown' }

/** PoB codes are url-safe base64 of zlib data: long, no spaces. */
export function looksLikePobCode(text: string): boolean {
  return /^[A-Za-z0-9_\-+/=]{50,}$/.test(text)
}

export function parseBuildSource(input: string): BuildSource {
  const text = input.trim()
  for (const site of BUILD_SITES) {
    const m = site.match.exec(text)
    if (m) return { kind: 'link', site: site.label, url: site.raw(m[1]!) }
  }
  const compact = text.replace(/\s+/g, '')
  if (looksLikePobCode(compact)) return { kind: 'code', code: compact }
  return { kind: 'unknown' }
}

import { en, type Translator } from '../../shared/i18n'

export type FetchText = (url: string) => Promise<string>

/** PoB code from what the player pasted (downloads it for a link). Throws a readable error. */
export async function resolveBuildCode(input: string, fetchText: FetchText, t: Translator = en): Promise<string> {
  const src = parseBuildSource(input)
  if (src.kind === 'code') return src.code
  if (src.kind === 'unknown') {
    throw new Error(t('Not a PoB code or a supported link (pobb.in, poe.ninja, Maxroll, poe2db, Pastebin)'))
  }
  let body: string
  try {
    body = await fetchText(src.url)
  } catch (err) {
    throw new Error(t('Could not download the build from {site}: {error}', { site: src.site, error: err instanceof Error ? err.message : String(err) }))
  }
  const code = body.trim().replace(/\s+/g, '')
  if (!looksLikePobCode(code)) throw new Error(t('{site} did not return a PoB code (link expired or private?)', { site: src.site }))
  return code
}
