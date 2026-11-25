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
const env = { ...process.env, POE2_CLIENT_LOG: logPath, POE2_FILTER_DIR: filterDir, POE2_NO_UPDATES: '1', POE2_LANG: 'en' }
if (packaged) delete env.POB_ENGINE_DIR
const app = await electron.launch({ args, env, ...(packaged ? { executablePath: packaged } : {}) })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1440, height: 1000 })
const fail = (msg) => {
  console.error('FAIL:', msg)
  process.exitCode = 1
}
const step = (name) => console.log(`· ${name}`)
/** What the global compare shortcut does (main process: read the clipboard once, compare). */
const pressCompareHotkey = () => app.evaluate(({ app: electronApp }) => electronApp.emit('compare-hotkey'))

try {
  await win.getByText('Reading Client.txt').waitFor({ timeout: 15_000 })
  await win.getByText(/● engine \d/).waitFor({ timeout: 60_000 })

  step('a broken build code or random text shows an error')
  const codeBox = win.getByPlaceholder('PoB code or link (pobb.in, poe.ninja, Maxroll…)')
  await codeBox.fill('this is not a build code, just some text')
  await win.getByRole('button', { name: 'Import', exact: true }).click()
  await win.getByText(/Not a PoB code or a supported link/).first().waitFor({ timeout: 15_000 })
  await codeBox.fill('eNrt' + 'A'.repeat(60))
  await win.getByRole('button', { name: 'Import', exact: true }).click()
  await win.getByText(/invalid build code/).first().waitFor({ timeout: 15_000 })

  step('import build with "Paste & import" (clipboard read once, on click)')
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), BUILD_CODE)
  await win.getByRole('button', { name: 'Paste & import' }).click()
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

  step('Ctrl+C on an item in game, then the compare shortcut → comparison')
  // GGG rules: one clipboard read per key press. Copying alone does nothing…
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), ITEM)
  await win.waitForTimeout(1_500)
  if (await win.locator('section', { hasText: 'Compare an item' }).getByText('replaces your').isVisible()) fail('clipboard read without the shortcut')
  // On Windows the global shortcut must register for real.
  if (process.platform === 'win32' && (await win.getByText('already used by another app').isVisible())) fail('compare shortcut not registered')
  // The shortcut with no item in the clipboard explains what to do.
  await app.evaluate(async ({ clipboard }) => clipboard.writeText('some text from a browser'))
  await pressCompareHotkey()
  await win.locator('section', { hasText: 'Compare an item' }).getByText('No item in your clipboard').waitFor({ timeout: 10_000 })
  // …then the item: the shortcut reads it once (a global shortcut can't be pressed from the test: same code path).
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), ITEM)
  await pressCompareHotkey()
  await win.locator('section', { hasText: 'Compare an item' }).getByText('replaces your').waitFor({ timeout: 15_000 })
  const compare = await win.locator('section', { hasText: 'Compare an item' }).innerText()
  if (!(await win.getByRole('status', { name: 'Comparison verdict' }).first().isVisible())) fail('no comparison verdict')
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
  await lf.getByRole('button', { name: 'Analyse my loot filter' }).click()
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

  step('Build tab: what to upgrade first, and each item line by line')
  const prio = win.locator('section', { hasText: 'What to upgrade first' })
  await prio.getByRole('button', { name: 'Analyse my gear' }).click()
  await prio.getByRole('list', { name: 'Upgrade priorities' }).waitFor({ timeout: 60_000 })
  const prioText = await prio.innerText()
  if (!/#1/.test(prioText) || !/A good rare here would give/.test(prioText)) fail(`priorities: ${prioText}`)
  const sheets = win.locator('section', { hasText: 'Your items, line by line' })
  await sheets.getByLabel('Item to inspect').selectOption('Body Armour')
  await sheets.getByText('+90 to maximum Life').waitFor({ timeout: 10_000 })
  if (!/Gives you .*survivability/.test(await sheets.innerText())) fail(`item sheet: ${await sheets.innerText()}`)
  await prio.scrollIntoViewIfNeeded()
  await win.screenshot({ path: join(SHOTS, 'screenshot-gear-advice.png') })

  step('Build tab: optimisations (passive tree & supports)')
  const opt = win.locator('section', { hasText: 'Optimisations: passive tree & supports' })
  await opt.getByRole('button', { name: 'Find optimisations' }).click()
  await opt.getByText(/Best next points/).waitFor({ timeout: 60_000 })
  // The e2e build only punches: a clear message, not an engine error.
  await opt.getByText(/No skill gem in your main skill group/).waitFor({ timeout: 5_000 })
  if (/\.lua:\d+/.test(await opt.innerText())) fail('raw engine error shown')
  await opt.scrollIntoViewIfNeeded()
  await win.screenshot({ path: join(SHOTS, 'screenshot-optimisations.png') })

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
  await guide.getByPlaceholder('Guide PoB code or link (pobb.in, poe.ninja, Maxroll…)').fill(GUIDE_CODE)
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
  await guide.getByPlaceholder('Guide PoB code or link (pobb.in, poe.ninja, Maxroll…)').fill(GUIDE_TREE_CODE)
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

  step('shortcut from another tab: notice instead of switching; currency is not compared')
  await app.evaluate(
    async ({ clipboard }, text) => clipboard.writeText(text),
    'Item Class: Stackable Currency\nRarity: Currency\nExalted Orb\n--------\nStack Size: 3/20'
  )
  await pressCompareHotkey()
  await win.waitForTimeout(1_500)
  if (await win.getByText('New item compared').isVisible()) fail('currency triggered a comparison')
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), ITEM.replace('+90 to maximum Life', '+10 to maximum Life'))
  await pressCompareHotkey()
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

  step('in-game overlay: map info, verdict pop-up when hidden, move and lock, turn off')
  const overlayState = () =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'PoE2 Tracker overlay')
      return w ? { visible: w.isVisible(), top: w.isAlwaysOnTop(), focusable: w.isFocusable() } : null
    })
  const until = async (what, check) => {
    for (let i = 0; i < 50; i++) {
      if (check(await overlayState())) return
      await win.waitForTimeout(200)
    }
    const page = app.windows().find((w) => w.url().includes('#overlay'))
    const shown = page ? await page.locator('#root').innerHTML().catch(() => '?') : 'no page'
    fail(`overlay: ${what} (${JSON.stringify(await overlayState())}) ${shown.slice(0, 1500)}`)
  }
  const overlayPage = async () => {
    for (let i = 0; i < 50; i++) {
      const p = app.windows().find((w) => w.url().includes('#overlay'))
      if (p) return p
      await win.waitForTimeout(200)
    }
    throw new Error('no overlay window')
  }
  let ov = await overlayPage()
  await ov.getByText(/Today: \d+ maps?/).waitFor({ timeout: 10_000 })
  await until('shown on top, never focused', (s) => s?.visible && s.top && !s.focusable)
  // The verdict of the last comparison (a few steps ago) goes away after 15 s.
  await ov.getByTestId('overlay-comparison').waitFor({ state: 'hidden', timeout: 20_000 })
  // Hidden with the show/hide shortcut (same code path)…
  await win.evaluate(() => window.tracker.setOverlay({ visible: false }))
  await until('hidden', (s) => s && !s.visible)
  // …the item verdict still pops up, without the map info.
  await app.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), ITEM)
  await pressCompareHotkey()
  await ov.getByTestId('overlay-comparison').waitFor({ timeout: 15_000 })
  await until('shown for the comparison', (s) => s?.visible)
  if (await ov.getByText(/Today:/).isVisible()) fail('overlay map info shown while hidden')
  const verdict = await ov.getByTestId('overlay-comparison').innerText()
  // The same item as the one equipped earlier.
  if (!verdict.includes('No real difference')) fail(`overlay verdict: ${verdict}`)
  await win.evaluate(() => window.tracker.setOverlay({ visible: true }))
  await ov.getByText(/Today:/).waitFor({ timeout: 5_000 })
  await ov.getByTestId('overlay').screenshot({ path: join(SHOTS, 'screenshot-overlay.png') })
  // Move it from Settings, lock it from the overlay itself.
  await win.getByRole('button', { name: 'Settings' }).click()
  const settingsDialog = win.getByRole('dialog', { name: 'Settings' })
  await settingsDialog.getByRole('button', { name: 'Move the overlay' }).click()
  await ov.getByText('Drag to move').waitFor({ timeout: 5_000 })
  await until('clickable while unlocked', (s) => s?.focusable)
  await ov.getByRole('button', { name: 'Lock' }).click()
  await ov.getByText('Drag to move').waitFor({ state: 'hidden', timeout: 5_000 })
  await until('locked again', (s) => s && !s.focusable)
  // Turned off: no window at all; back on: it comes back.
  await settingsDialog.getByLabel('In-game overlay').uncheck()
  await until('closed', (s) => s === null)
  await settingsDialog.getByLabel('In-game overlay').check()
  ov = await overlayPage()
  await ov.getByText(/Today:/).waitFor({ timeout: 10_000 })
  await settingsDialog.getByRole('button', { name: 'Close' }).click()

  step('Settings: switch the interface to French, then back to English')
  await win.getByRole('button', { name: 'Settings' }).click()
  const settings = win.getByRole('dialog', { name: 'Settings' })
  await settings.getByLabel('Language').selectOption('fr')
  await win.getByRole('tab', { name: 'Tableau de bord' }).waitFor({ timeout: 5_000 })
  await win.getByRole('dialog', { name: 'Réglages' }).getByText('Mises à jour automatiques').waitFor({ timeout: 5_000 })
  await win.keyboard.press('Escape')
  await win.getByRole('tab', { name: 'Tableau de bord' }).click()
  await win.getByText('Profit aujourd’hui').or(win.getByText("Profit aujourd'hui")).first().waitFor({ timeout: 5_000 })
  await win.getByRole('tab', { name: 'Build' }).click()
  await win.getByText('Résistances', { exact: true }).first().waitFor({ timeout: 10_000 })
  await win.screenshot({ path: join(SHOTS, 'screenshot-fr.png') })
  await win.getByRole('button', { name: 'Réglages' }).click()
  await win.getByRole('dialog', { name: 'Réglages' }).getByLabel('Langue').selectOption('en')
  await win.getByRole('tab', { name: 'Dashboard' }).waitFor({ timeout: 5_000 })
  await win.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click()

  console.log(process.exitCode ? 'E2E FAILED' : 'E2E OK')
} catch (err) {
  await win.screenshot({ path: join(work, 'failure.png') }).catch(() => {})
  fail(`${err.message} (screenshot: ${join(work, 'failure.png')})`)
} finally {
  await app.close()
}
