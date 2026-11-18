// End-to-end smoke test of the built app (run `npm run build` first).
//
//   xvfb-run -a node tests/e2e/app.e2e.mjs      (Linux, headless)
//   node tests/e2e/app.e2e.mjs                   (Windows/macOS)
//
// Simulates a Client.txt session, then checks the UI picks up the runs and
// that item comparison goes through the Path of Building engine.

import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const ROOT = resolve(import.meta.dirname, '..', '..')
const work = mkdtempSync(join(tmpdir(), 'poe2-e2e-'))
const logPath = join(work, 'Client.txt')
writeFileSync(logPath, '')

const pad = (n) => String(n).padStart(2, '0')
function line(date, msg) {
  const d = `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return `${d} 1000 abcdef12 [INFO Client 1] ${msg}\n`
}

const ITEM = `Item Class: Body Armours
Rarity: Rare
Gloom Shell
Iron Cuirass
--------
Item Level: 80
--------
+90 to maximum Life
+40% to Fire Resistance`

const args = [ROOT, `--user-data-dir=${join(work, 'userdata')}`]
if (process.platform === 'linux') args.push('--no-sandbox')

const app = await electron.launch({ args, env: { ...process.env, POE2_CLIENT_LOG: logPath } })
const win = await app.firstWindow()
const fail = (msg) => {
  console.error('FAIL:', msg)
  process.exitCode = 1
}

try {
  await win.getByText('Reading Client.txt').waitFor({ timeout: 15_000 })

  // A 4-minute map, a death, back to hideout, then a second map.
  const t0 = new Date(Date.now() - 10 * 60_000)
  const at = (min) => new Date(t0.getTime() + min * 60_000)
  appendFileSync(
    logPath,
    line(at(0), 'Generating level 65 area "HideoutBattleground" with seed 1') +
      line(at(1), 'Connecting to instance server at 10.0.0.1:6112') +
      line(at(1), 'Generating level 79 area "MapCrypt" with seed 111') +
      line(at(1), ': You have entered Crypt.') +
      line(at(3), ': Kasper has been slain.') +
      line(at(5), 'Generating level 65 area "HideoutBattleground" with seed 1') +
      line(at(6), 'Generating level 80 area "MapSavanna" with seed 222') +
      line(at(6), ': You have entered Savanna.')
  )

  await win.getByText('Savanna', { exact: true }).waitFor({ timeout: 10_000 })
  await win.getByRole('cell', { name: 'Crypt' }).waitFor({ timeout: 10_000 })
  const mapsToday = await win.locator('text=Maps today').locator('..').innerText()
  if (!mapsToday.includes('1')) fail(`maps today: ${mapsToday}`)

  // PoB engine (needs `npm run setup:pob`).
  await win.getByText(/● engine \d/).waitFor({ timeout: 60_000 })
  await win.getByPlaceholder(/Ctrl\+C/).fill(ITEM)
  await win.getByRole('button', { name: 'Compare' }).click()
  await win.getByText('replaces your').waitFor({ timeout: 15_000 })
  const compare = await win.locator('section', { hasText: 'Compare an item' }).innerText()
  if (!/Fire res[\s\S]*-50%[\s\S]*-10%/.test(compare)) fail(`compare output: ${compare}`)

  await win.screenshot({ path: join(ROOT, 'docs', 'screenshot.png') })
  console.log(process.exitCode ? 'E2E FAILED' : 'E2E OK')
} catch (err) {
  await win.screenshot({ path: join(work, 'failure.png') }).catch(() => {})
  fail(`${err.message} (screenshot: ${join(work, 'failure.png')})`)
} finally {
  await app.close()
}
