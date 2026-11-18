// End-to-end test of the built app (run `npm run build` and `npm run setup:pob` first).
//
//   xvfb-run -a node tests/e2e/app.e2e.mjs      (Linux, headless)
//   node tests/e2e/app.e2e.mjs                   (Windows/macOS)
//
// Plays a full session: Client.txt maps, strategy auto-applied to each map,
// loot declared, build imported, item compared via Ctrl+C, item equipped.

import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const ROOT = resolve(import.meta.dirname, '..', '..')
const SHOTS = process.env.E2E_SCREENSHOTS ?? join(ROOT, 'docs')
const work = mkdtempSync(join(tmpdir(), 'poe2-e2e-'))
const logPath = join(work, 'Client.txt')
writeFileSync(logPath, '')
const BUILD_CODE = readFileSync(join(ROOT, 'tests', 'fixtures', 'build-level1.pobcode'), 'utf8').trim()

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
await win.setViewportSize({ width: 1440, height: 1000 })
const fail = (msg) => {
  console.error('FAIL:', msg)
  process.exitCode = 1
}
const step = (name) => console.log(`· ${name}`)

try {
  await win.getByText('Reading Client.txt').waitFor({ timeout: 15_000 })
  await win.getByText(/● engine \d/).waitFor({ timeout: 60_000 })

  step('import build')
  await win.getByPlaceholder('PoB code (eNrt…)').fill(BUILD_CODE)
  await win.getByRole('button', { name: 'Import build' }).click()
  await win.getByText(/v1 · Imported/).waitFor({ timeout: 15_000 })

  step('create a strategy with an unpriced waystone, auto-applied')
  const strategies = win.locator('section', { hasText: 'Strategies' })
  await strategies.getByRole('button', { name: 'New' }).click()
  await strategies.getByPlaceholder(/Name/).fill('T15 test')
  await strategies.getByPlaceholder(/^Item/).fill('Waystone (Tier 15)')
  await strategies.getByLabel('Value in divine').fill('0.5')
  await strategies.getByRole('button', { name: 'Add', exact: true }).click()
  await strategies.getByRole('button', { name: 'Save' }).click()
  await strategies.getByText('T15 test').waitFor()
  await strategies.getByLabel(/Apply the selected strategy/).check()

  step('play two maps')
  const t0 = new Date(Date.now() - 10 * 60_000)
  const at = (min) => new Date(t0.getTime() + min * 60_000)
  appendFileSync(
    logPath,
    line(at(0), 'Generating level 65 area "HideoutBattleground" with seed 1') +
      line(at(1), 'Generating level 79 area "MapCrypt" with seed 111') +
      line(at(1), ': You have entered Crypt.') +
      line(at(3), ': Kasper has been slain.') +
      line(at(5), 'Generating level 65 area "HideoutBattleground" with seed 1')
  )
  await win.getByText('In hideout — portal still open').waitFor({ timeout: 10_000 })

  step('declare loot on the current map')
  const thisMap = win.locator('section', { hasText: 'This map' })
  await thisMap.getByText('Invested').locator('..').getByText('0.50 div').waitFor({ timeout: 5_000 })
  await thisMap.getByPlaceholder(/^Item/).fill('Test loot')
  await thisMap.getByLabel('Quantity').fill('2')
  await thisMap.getByLabel('Value in divine').fill('1.5')
  await thisMap.getByRole('button', { name: 'Add', exact: true }).click()
  await thisMap.getByText('+2.50 div').waitFor({ timeout: 5_000 })

  appendFileSync(logPath, line(at(6), 'Generating level 80 area "MapSavanna" with seed 222') + line(at(6), ': You have entered Savanna.'))
  await win.getByRole('cell', { name: 'Crypt' }).waitFor({ timeout: 10_000 })
  const profit = await win.locator('text=Profit today').locator('..').innerText()
  if (!profit.includes('+2.50 div')) fail(`profit today: ${profit}`)
  const nextInvested = await win.locator('section', { hasText: 'This map' }).getByText('Invested').locator('..').innerText()
  if (!nextInvested.includes('0.50 div')) fail(`strategy not auto-applied to the 2nd map: ${nextInvested}`)

  step('Ctrl+C an item in game → automatic comparison')
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), ITEM)
  await win.getByText('replaces your').waitFor({ timeout: 15_000 })
  const compare = await win.locator('section', { hasText: 'Compare an item' }).innerText()
  if (!/Fire res[\s\S]*-50%[\s\S]*-10%/.test(compare)) fail(`compare output: ${compare}`)
  await win.screenshot({ path: join(SHOTS, 'screenshot.png') })

  step('equip it → new build version')
  await win.getByRole('button', { name: 'I equipped it' }).click()
  await win.getByText(/v2 · Equipped Gloom Shell/).waitFor({ timeout: 15_000 })
  await win.getByText('Build versions').waitFor({ timeout: 5_000 })

  console.log(process.exitCode ? 'E2E FAILED' : 'E2E OK')
} catch (err) {
  await win.screenshot({ path: join(work, 'failure.png') }).catch(() => {})
  fail(`${err.message} (screenshot: ${join(work, 'failure.png')})`)
} finally {
  await app.close()
}
