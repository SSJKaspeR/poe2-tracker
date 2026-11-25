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
