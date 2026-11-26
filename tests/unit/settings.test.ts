import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TrackerService } from '../../src/main/TrackerService'

/** Settings kept by the service (no engine, no network: start() is never called). */
function service(dbPath: string, locale?: string): TrackerService {
  return new TrackerService({ dbPath, pob: null, locale })
}

describe('settings', () => {
  it('English by default, French once chosen, kept after a restart', () => {
    const db = join(mkdtempSync(join(tmpdir(), 'poe2-settings-')), 'a.db')
    const svc = service(db)
    expect(svc.status().language).toBe('en')
    expect(svc.t('Dashboard')).toBe('Dashboard')
    svc.setLanguage('fr')
    expect(svc.t('Dashboard')).toBe('Tableau de bord')
    expect(service(db).status().language).toBe('fr')
    expect(service(join(mkdtempSync(join(tmpdir(), 'poe2-settings-')), 'b.db'), 'fr-FR').status().language).toBe('fr')
  })

  it('overlay: on and shown by default, hide / show, unlock to move, position kept', () => {
    const db = join(mkdtempSync(join(tmpdir(), 'poe2-settings-')), 'a.db')
    const svc = service(db)
    expect(svc.status().overlay).toMatchObject({ enabled: true, visible: true, locked: true })
    expect(svc.status().overlay.hotkey).toMatchObject({ accelerator: 'CommandOrControl+Shift+O', label: 'Ctrl+Shift+O' })

    svc.setOverlay({ visible: false })
    expect(svc.status().overlay.visible).toBe(false)
    // Unlocking to move it shows it.
    svc.setOverlay({ locked: false })
    expect(svc.status().overlay).toMatchObject({ visible: true, locked: false })
    // Turning it off locks it again; turning it on shows it.
    svc.setOverlay({ enabled: false })
    expect(svc.status().overlay).toMatchObject({ enabled: false, locked: true })
    svc.setOverlay({ visible: false })
    svc.setOverlay({ enabled: true })
    expect(svc.status().overlay).toMatchObject({ enabled: true, visible: true })

    expect(svc.getOverlayPosition()).toBeNull()
    svc.setOverlayPosition({ x: 40.4, y: -12 })
    svc.setOverlayHotkey(null)
    svc.setOverlay({ enabled: false })
    const again = service(db)
    expect(again.getOverlayPosition()).toEqual({ x: 40, y: -12 })
    expect(again.status().overlay).toMatchObject({ enabled: false, locked: true, hotkey: { accelerator: null, label: null } })
  })
})

describe('AI explanations', () => {
  const comparison = {
    slot: 'Helmet',
    item: { name: 'Doom Crown', rarity: 'RARE' },
    before: {},
    after: {},
    diff: { Life: { before: 2000, after: 2100, delta: 100 } }
  }

  it('off by default; key encrypted on disk, or kept in memory without secure storage', async () => {
    const db = join(mkdtempSync(join(tmpdir(), 'poe2-ai-')), 'a.db')
    const secrets = { encrypt: (s: string) => `enc:${[...s].reverse().join('')}`, decrypt: (s: string) => [...s.slice(4)].reverse().join('') }
    const svc = new TrackerService({ dbPath: db, pob: null, secrets })
    expect(svc.status().ai).toEqual({ provider: null, model: null, key: null })
    expect(await svc.askAi({ kind: 'comparison', comparison })).toMatchObject({ ok: false, error: expect.stringContaining('Settings') })

    svc.setAi({ provider: 'anthropic' })
    expect(svc.status().ai).toEqual({ provider: 'anthropic', model: 'claude-haiku-5-5', key: null })
    svc.setAi({ apiKey: ' sk-ant-secret ', model: 'claude-sonnet-5-5' })
    expect(svc.status().ai).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5', key: 'saved' })
    // A restart reads the encrypted key back.
    let sent: { headers: Record<string, string>; body: string } | null = null
    const http = async (_url: string, init: { headers: Record<string, string>; body?: string }) => {
      sent = { headers: init.headers, body: init.body! }
      return { status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: 'Yes, equip it.' }] }) }
    }
    const again = new TrackerService({ dbPath: db, pob: null, secrets, http })
    expect(again.status().ai.key).toBe('saved')
    expect(await again.askAi({ kind: 'comparison', comparison })).toEqual({
      ok: true,
      value: { answer: 'Yes, equip it.', provider: 'anthropic', model: 'claude-sonnet-5-5' }
    })
    expect(sent!.headers['x-api-key']).toBe('sk-ant-secret')
    expect(sent!.body).toContain('Doom Crown')
    again.setAi({ apiKey: null })
    expect(again.status().ai.key).toBeNull()

    // No secure storage: the key lives until the app closes, never on disk.
    const plain = new TrackerService({ dbPath: db, pob: null })
    plain.setAi({ provider: 'openai', apiKey: 'sk-mem' })
    expect(plain.status().ai).toMatchObject({ provider: 'openai', model: 'gpt-6-luna', key: 'session' })
    expect(new TrackerService({ dbPath: db, pob: null }).status().ai).toMatchObject({ provider: 'openai', key: null })
  })

  it('errors are explained in the player language', async () => {
    const db = join(mkdtempSync(join(tmpdir(), 'poe2-ai-')), 'a.db')
    const refused = async () => ({ status: 401, text: async () => '{"error":{"message":"invalid key"}}' })
    const svc = new TrackerService({ dbPath: db, pob: null, http: refused })
    svc.setLanguage('fr')
    svc.setAi({ provider: 'openai', apiKey: 'bad' })
    expect(await svc.askAi({ kind: 'comparison', comparison })).toEqual({ ok: false, error: 'Ta clé API a été refusée : vérifie-la dans les Réglages.' })
    const down = new TrackerService({
      dbPath: db,
      pob: null,
      http: async () => {
        throw new Error('ECONNREFUSED')
      }
    })
    down.setAi({ provider: 'ollama' })
    expect(await down.askAi({ kind: 'build' })).toMatchObject({ ok: false })
    expect((await down.ollamaModels()).ok).toBe(false)
    expect(await down.askAi({ kind: 'comparison', comparison })).toEqual({
      ok: false,
      error: "Ollama ne tourne pas sur cet ordinateur : lance-le, puis réessaie."
    })
  })
})
