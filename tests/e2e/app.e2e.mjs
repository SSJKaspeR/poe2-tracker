// End-to-end test of the built app (run `npm run build` and `npm run setup:pob` first).
//
//   xvfb-run -a node tests/e2e/app.e2e.mjs      (Linux, headless)
//   node tests/e2e/app.e2e.mjs                   (Windows/macOS)
//
// Plays a full session: Client.txt maps, strategy auto-applied to each map,
// loot declared, build imported, item compared via Ctrl+C, item equipped.

import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const ROOT = resolve(import.meta.dirname, '..', '..')
const SHOTS = process.env.E2E_SCREENSHOTS ?? join(ROOT, 'docs')
const work = mkdtempSync(join(tmpdir(), 'poe2-e2e-'))
const logPath = join(work, 'Client.txt')
writeFileSync(logPath, '')
const BUILD_CODE = readFileSync(join(ROOT, 'tests', 'fixtures', 'build-level1.pobcode'), 'utf8').trim()
const GUIDE_CODE = readFileSync(join(ROOT, 'tests', 'fixtures', 'build-guide.pobcode'), 'utf8').trim()
const GUIDE_TREE_CODE = readFileSync(join(ROOT, 'tests', 'fixtures', 'build-guide-treegems.pobcode'), 'utf8').trim()

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

// E2E_EXECUTABLE=<path to the packaged app> tests the installed build instead of the dev build.
const packaged = process.env.E2E_EXECUTABLE
const args = [...(packaged ? [] : [ROOT]), `--user-data-dir=${join(work, 'userdata')}`]
if (process.platform === 'linux') args.push('--no-sandbox')

// The packaged app must find its own engine: hide dev engine overrides.
const filterDir = join(work, 'Path of Exile 2')
mkdirSync(filterDir)
copyFileSync(join(ROOT, 'tests/fixtures/filters/neversink-6-uber-plus-strict.filter'), join(filterDir, 'NeverSink Uber Plus.filter'))
writeFileSync(join(filterDir, 'poe2_production_Config.ini'), 'item_filter=NeverSink Uber Plus.filter\n')
// No update check against GitHub during tests.
const env = { ...process.env, POE2_CLIENT_LOG: logPath, POE2_FILTER_DIR: filterDir, POE2_NO_UPDATES: '1' }
if (packaged) delete env.POB_ENGINE_DIR
const app = await electron.launch({ args, env, ...(packaged ? { executablePath: packaged } : {}) })
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

  step('a broken build code shows an error')
  await win.getByPlaceholder('PoB code (eNrt…)').fill('eNrt' + 'A'.repeat(40))
  await win.getByRole('button', { name: 'Import build' }).click()
  await win.getByText(/invalid build code/).first().waitFor({ timeout: 15_000 })

  step('import build')
  await win.getByPlaceholder('PoB code (eNrt…)').fill(BUILD_CODE)
  await win.getByRole('button', { name: 'Import build' }).click()
  await win.getByText(/v1 · Imported/).first().waitFor({ timeout: 15_000 })

  step('create a strategy with an unpriced waystone, auto-applied')
  const strategies = win.locator('section', { hasText: 'Strategies' })
  await strategies.getByRole('button', { name: 'New' }).click()
  await strategies.getByPlaceholder(/Name/).fill('T15 test')
  await strategies.getByPlaceholder(/^Item/).fill('Waystone (Tier 15)')
  // Values ≥ 1 div are always shown in div, whatever the exalted rate.
  await strategies.getByLabel('Value in divine').fill('2')
  await strategies.getByRole('button', { name: 'Add', exact: true }).click()
  await strategies.getByRole('button', { name: 'Save' }).click()
  await strategies.getByText('T15 test').waitFor()
  await strategies.getByLabel(/Apply the selected strategy/).check()

  step('start a "rush maps" session (objective: 1 map)')
  const sessionCard = win.locator('section', { hasText: 'Session' }).first()
  await sessionCard.getByRole('button', { name: 'Rush maps' }).click()
  await sessionCard.getByLabel('Number of maps').fill('1')
  await sessionCard.getByRole('button', { name: 'Start session' }).click()
  await win.getByText('Session · Rush maps').waitFor({ timeout: 5_000 })

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
  await thisMap.getByText('Invested').locator('..').getByText('2.00 div').waitFor({ timeout: 5_000 })
  await thisMap.getByPlaceholder(/^Item/).fill('Test loot')
  await thisMap.getByLabel('Quantity').fill('2')
  await thisMap.getByLabel('Value in divine').fill('3')
  await thisMap.getByRole('button', { name: 'Add', exact: true }).click()
  await thisMap.getByText('+4.00 div').waitFor({ timeout: 5_000 })

  appendFileSync(logPath, line(at(6), 'Generating level 80 area "MapSavanna" with seed 222') + line(at(6), ': You have entered Savanna.'))
  await win.getByRole('cell', { name: 'Crypt' }).waitFor({ timeout: 10_000 })
  const profit = await win.locator('text=Profit today').locator('..').innerText()
  if (!profit.includes('+4.00 div')) fail(`profit today: ${profit}`)
  const nextInvested = await win.locator('section', { hasText: 'This map' }).getByText('Invested').locator('..').innerText()
  if (!nextInvested.includes('2.00 div')) fail(`strategy not auto-applied to the 2nd map: ${nextInvested}`)

  await win.getByText('Objective reached — 1 maps done.').waitFor({ timeout: 5_000 })

  step('Ctrl+C an item in game → automatic comparison')
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), ITEM)
  await win.locator('section', { hasText: 'Compare an item' }).getByText('replaces your').waitFor({ timeout: 15_000 })
  const compare = await win.locator('section', { hasText: 'Compare an item' }).innerText()
  if (!/Fire res[\s\S]*-50%[\s\S]*-10%/.test(compare)) fail(`compare output: ${compare}`)
  await win.screenshot({ path: join(SHOTS, 'screenshot.png') })

  step('equip it → new build version')
  await win.getByRole('button', { name: 'I equipped it' }).click()
  await win.getByText(/v2 · Equipped Gloom Shell/).first().waitFor({ timeout: 15_000 })

  step('Dashboard: verdicts on the build, with a link to the Build tab')
  const verdicts = win.locator('section', { hasText: 'Verdicts' })
  await verdicts.getByText('Elemental resistances not capped').waitFor({ timeout: 20_000 })
  await verdicts.scrollIntoViewIfNeeded()
  await win.screenshot({ path: join(SHOTS, 'screenshot-verdicts.png') })
  await verdicts.getByRole('button', { name: 'Build →' }).first().click()
  if (!(await win.getByRole('tab', { name: 'Build' }).getAttribute('aria-selected'))?.includes('true')) fail('verdict link did not open the Build tab')
  await win.getByRole('tab', { name: /Dashboard/ }).click()

  step('Maps tab: history with economy and run detail')
  await win.getByRole('tab', { name: 'Maps' }).click()
  const maps = win.locator('section', { hasText: 'Runs' })
  await maps.getByRole('cell', { name: 'Crypt' }).waitFor({ timeout: 5_000 })
  const row = await maps.getByRole('row', { name: /Crypt/ }).innerText()
  if (!row.includes('T15 test') || !row.includes('+4.00 div')) fail(`maps row: ${row}`)
  await maps.getByRole('cell', { name: 'Crypt' }).click()
  await maps.getByText('2 × Test loot').waitFor({ timeout: 5_000 })
  await win.screenshot({ path: join(SHOTS, 'screenshot-maps.png') })

  step('Maps tab: loot filter detected, hidden valuable items listed')
  const lf = win.locator('section', { hasText: 'Loot filter' })
  await lf.getByText('6-UBER-PLUS-STRICT').waitFor({ timeout: 10_000 })
  await lf.getByRole('button', { name: '0.5 ex' }).click()
  await lf.getByText(/Your filter (hides|shows everything)/).waitFor({ timeout: 10_000 })
  await lf.scrollIntoViewIfNeeded()
  await win.screenshot({ path: join(SHOTS, 'screenshot-loot-filter.png') })

  step('Build tab: full stats and change timeline')
  await win.getByRole('tab', { name: 'Build' }).click()
  const timeline = win.locator('section', { hasText: 'Changes & impact' })
  await timeline.getByText(/v2 · Equipped Gloom Shell/).waitFor({ timeout: 5_000 })
  const changes = await timeline.innerText()
  if (!/Life \+95/.test(changes) || !/Fire res \+40%/.test(changes)) fail(`timeline: ${changes}`)
  if (!/1 map/.test(changes)) fail(`timeline perf: ${changes}`)
  const equipment = win.locator('section', { hasText: 'Equipment & gear check' })
  await equipment.getByText('Body Armour').waitFor({ timeout: 5_000 })
  await equipment.getByText(/At least 4 open modifiers \(2\/6\)/).waitFor({ timeout: 10_000 })
  await equipment.getByText(/more sockets possible/).waitFor({ timeout: 5_000 })
  await win.getByText(/Gear check: .*easy win/).waitFor({ timeout: 5_000 })
  await win.screenshot({ path: join(SHOTS, 'screenshot-build.png') })

  step('Build tab: find an upgrade on trade')
  await app.evaluate(({ shell }) => {
    globalThis.__opened = []
    shell.openExternal = async (u) => {
      globalThis.__opened.push(u)
    }
  })
  await win.getByRole('button', { name: 'Find an upgrade for Body Armour' }).click()
  const trade = win.locator('section', { hasText: 'Find an upgrade on trade' })
  await trade.getByText('to maximum Life').first().waitFor({ timeout: 30_000 })
  const lifeRow = trade.getByRole('row', { name: /to maximum Life/ }).first()
  await lifeRow.getByRole('radio', { name: 'Must have' }).click()
  await lifeRow.getByLabel(/Minimum for/).fill('100')
  await trade.getByLabel('Max price').fill('3')
  await trade.getByText(/would give you \(PoB\)/).waitFor({ timeout: 15_000 })
  // The current item gives +40% fire res: losing it is flagged.
  await trade.getByText(/Fire res would drop to/).waitFor({ timeout: 5_000 })
  await trade.getByRole('button', { name: /Show all \d+ stats/ }).click()
  await trade.getByRole('button', { name: 'Open trade search' }).click()
  await win.waitForTimeout(500)
  const opened = await app.evaluate(() => globalThis.__opened)
  const tradeUrl = opened.at(-1) ?? ''
  if (!tradeUrl.startsWith('https://www.pathofexile.com/trade2/search/poe2/')) fail(`trade url: ${tradeUrl}`)
  const tq = JSON.parse(decodeURIComponent(tradeUrl.split('?q=')[1] ?? '{}'))
  const and = tq.query?.stats?.find((x) => x.type === 'and')
  if (!and || and.filters[0]?.value?.min !== 100) fail(`required life min: ${JSON.stringify(tq.query?.stats)}`)
  if (tq.query?.filters?.type_filters?.filters?.category?.option !== 'armour.chest') fail('category')
  if (tq.query?.filters?.trade_filters?.filters?.price?.max !== 3) fail('max price')
  await trade.getByRole('button', { name: 'Show fewer stats' }).click()
  await trade.getByRole('button', { name: 'Open trade search' }).scrollIntoViewIfNeeded()
  await win.screenshot({ path: join(SHOTS, 'screenshot-trade.png') })

  step('Build tab: compare with a guide build')
  const guide = win.locator('section', { hasText: 'Compare with a guide build' })
  await guide.getByPlaceholder('Guide PoB code (eNrt…)').fill(GUIDE_CODE)
  await guide.getByPlaceholder(/Name \(optional/).fill('Test guide')
  await guide.getByRole('button', { name: 'Compare' }).click()
  await guide.getByText('Test guide').waitFor({ timeout: 30_000 })
  const g = await guide.innerText()
  if (!/Helmet[\s\S]*Empty slot[\s\S]*Black Sun Crest/.test(g)) fail(`guide helmet: ${g}`)
  if (!/missing \+30% to Cold Resistance/.test(g)) fail(`guide missing mods: ${g}`)
  if (!/lower \+120 to maximum Life \(you: 90\)/.test(g)) fail(`guide lower mods: ${g}`)
  if (!/Body Armour[\s\S]*Life \+3\d/.test(g)) fail(`guide impact: ${g}`)
  // The player's own build must be back in the engine after reading the guide.
  const stillMine = await win.locator('section', { hasText: 'Character' }).first().innerText()
  if (!stillMine.includes('Punch Ranger')) fail(`player build replaced: ${stillMine}`)
  await guide.scrollIntoViewIfNeeded()
  await win.screenshot({ path: join(SHOTS, 'screenshot-guide.png'), fullPage: false })

  step('guide with a passive tree and gems')
  await guide.getByRole('button', { name: 'Change guide' }).click()
  await guide.getByPlaceholder('Guide PoB code (eNrt…)').fill(GUIDE_TREE_CODE)
  await guide.getByPlaceholder(/Name \(optional/).fill('Tree guide')
  await guide.getByRole('button', { name: 'Compare' }).click()
  await guide.getByText('Tree guide').waitFor({ timeout: 60_000 })
  await guide.getByRole('tab', { name: 'Passive tree' }).click()
  await guide.getByText('Heartstopper').waitFor({ timeout: 5_000 })
  const tree = await guide.innerText()
  if (!/Keystones to take/i.test(tree) || !/Clean Shot|Honed Instincts/.test(tree)) fail(`tree view: ${tree}`)
  await win.screenshot({ path: join(SHOTS, 'screenshot-guide-tree.png') })
  await guide.getByRole('tab', { name: 'Skill gems' }).click()
  await guide.getByText('Lightning Arrow').first().waitFor({ timeout: 5_000 })
  const gems = await guide.innerText()
  if (!/Lightning Arrow[\s\S]*Not used[\s\S]*Lightning Penetration, Multishot I/i.test(gems)) fail(`gems view: ${gems}`)
  await win.screenshot({ path: join(SHOTS, 'screenshot-guide-gems.png') })

  step('Ctrl+C from another tab: notice instead of switching; currency price checks ignored')
  await app.evaluate(
    async ({ clipboard }, text) => clipboard.writeText(text),
    'Item Class: Stackable Currency\nRarity: Currency\nExalted Orb\n--------\nStack Size: 3/20'
  )
  await win.waitForTimeout(1_500)
  if (await win.getByText('New item compared').isVisible()) fail('currency copy triggered a comparison')
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), ITEM.replace('+90 to maximum Life', '+10 to maximum Life'))
  await win.getByText('New item compared').waitFor({ timeout: 15_000 })
  if (!(await win.getByRole('tab', { name: 'Build' }).getAttribute('aria-selected'))?.includes('true')) fail('tab was switched')
  await win.getByRole('button', { name: 'View comparison' }).click()
  await win.locator('section', { hasText: 'Compare an item' }).getByText('replaces your').waitFor({ timeout: 15_000 })
  if (!(await win.getByRole('tab', { name: /Dashboard/ }).getAttribute('aria-selected'))?.includes('true')) fail('dashboard not selected')

  step('boss session: arena tracked as an attempt, marked as killed')
  await win.getByRole('button', { name: 'End session' }).click()
  await win.getByRole('button', { name: 'Pinnacle boss' }).click()
  await win.getByLabel('Boss').fill('Arbiter of Ash')
  await win.getByLabel('Number of attempts').fill('3')
  await win.getByRole('button', { name: 'Start session' }).click()
  await win.getByText('Session · Boss — Arbiter of Ash').waitFor({ timeout: 5_000 })
  appendFileSync(
    logPath,
    line(at(8), 'Generating level 65 area "HideoutBattleground" with seed 1') +
      line(at(9), 'Generating level 82 area "PinnacleArbiterArena" with seed 900') +
      line(at(9), ': You have entered The Burning Monolith.')
  )
  const attempt = win.locator('section', { hasText: 'This attempt' })
  await attempt.getByRole('button', { name: 'Killed' }).click()
  const invested = await attempt.getByText('Invested').locator('..').innerText()
  if (invested.includes('2.00 div')) fail('map strategy was applied to a boss attempt')
  await win.locator('section', { hasText: 'Session · Boss' }).getByText('100%').waitFor({ timeout: 5_000 })
  const bossBar = await win.locator('section', { hasText: 'Session · Boss' }).innerText()
  if (!/Attempts\s*1\s*\/\s*3/.test(bossBar)) fail(`boss session: ${bossBar}`)
  await win.screenshot({ path: join(SHOTS, 'screenshot-boss.png') })

  step('hideout crafting session: spent / gained')
  await win.getByRole('button', { name: 'End session' }).click()
  await win.getByRole('button', { name: 'Hideout' }).click()
  await win.getByRole('radio', { name: 'Crafting' }).click()
  await win.getByRole('button', { name: 'Start session' }).click()
  const craft = win.locator('section', { hasText: 'Session · Hideout — crafting' })
  await craft.waitFor({ timeout: 5_000 })
  const [spentPicker, gainedPicker] = [craft.getByPlaceholder(/^Item/).nth(0), craft.getByPlaceholder(/^Item/).nth(1)]
  await spentPicker.fill('Test mats')
  await craft.getByLabel('Value in divine').nth(0).fill('1')
  await craft.getByRole('button', { name: 'Add', exact: true }).nth(0).click()
  await gainedPicker.fill('Test sale')
  await craft.getByLabel('Value in divine').nth(1).fill('3')
  await craft.getByRole('button', { name: 'Add', exact: true }).nth(1).click()
  await craft.getByText('+2.00 div').first().waitFor({ timeout: 5_000 })
  await win.screenshot({ path: join(SHOTS, 'screenshot-craft.png') })

  step('Sessions tab lists the three sessions')
  await win.getByRole('tab', { name: 'Sessions' }).click()
  const history = win.locator('section', { hasText: 'Sessions' }).last()
  await history.getByText('Hideout — crafting').waitFor({ timeout: 5_000 })
  const rows = await history.getByRole('row').count()
  if (rows !== 4) fail(`sessions rows: ${rows - 1}`)
  const text = await history.innerText()
  if (!text.includes('1 kill / 1') || !text.includes('Rush maps')) fail(`sessions: ${text}`)
  await win.screenshot({ path: join(SHOTS, 'screenshot-sessions.png') })

  console.log(process.exitCode ? 'E2E FAILED' : 'E2E OK')
} catch (err) {
  await win.screenshot({ path: join(work, 'failure.png') }).catch(() => {})
  fail(`${err.message} (screenshot: ${join(work, 'failure.png')})`)
} finally {
  await app.close()
}
