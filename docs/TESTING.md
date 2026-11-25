# Testing

## Which tests to run

| When | Command | Time (Linux) | What |
|---|---|---|---|
| Every change | `npm run check` | ~15 s | typecheck, unit tests (~100), smoke test on the real PoB engine (`tests/smoke`: start, Client.txt map, build import, item comparison, loot filter) |
| Big changes, before a release | `npm run check:full` | ~3 min | + every engine/service test (`tests/pob`), app build, end-to-end test of the whole app |

CI follows the same rule: every push runs the quick check on Linux. The full battery (Linux
`full` job + Windows build with installer and e2e on the installed app) runs on pull requests,
release tags `v*`, by hand (Actions → Run workflow), or when the commit message contains `[full]`.

## Releasing

1. `npm run check:full` (or a commit with `[full]`) is green.
2. Bump `version` in `package.json`, update `RELEASE_NOTES.md`, commit.
3. Push a tag `v<version>` (e.g. `git tag v0.2.0 && git push origin v0.2.0`).
4. The Windows workflow checks that the tag matches package.json, runs the full battery, builds the
   installer and publishes the GitHub Release with `latest.yml`. Installed apps see it within 6 hours
   (footer: "Restart to update", or applied when the app is closed).

New Path of Building release: the daily "Path of Building watch" workflow opens an issue with the steps.
The engine ships inside the app, so engine updates reach players through app releases.


| Suite | Command | What it covers | Where it runs |
|---|---|---|---|
| Unit | `npm test` | Pure logic, no engine (77 tests) | Linux CI, Windows CI |
| Engine + service | `npm run test:pob` | Real Path of Building engine, the whole service with a real database and Client.txt, robustness (29 tests) | Linux CI, Windows CI (Windows engine) |
| End-to-end | `npm run build && npm run test:e2e` | The built app driven like a player: a full session | Linux CI (dev build), Windows CI (**installed app**) |
| Live | `npm run test:live` | Every poe.ninja category against the real API | Manual (external service) |

`E2E_EXECUTABLE=<packaged app>` runs the end-to-end test against an installed build;
`POB_ENGINE_DIR=build/engine` runs the engine tests against the engine pack shipped in the installer.

## Feature coverage

| Feature | Unit | Engine / service | End-to-end |
|---|---|---|---|
| Client.txt parsing (zones, deaths, level up, whispers, AFK, CRLF) | parseLine | service | ✓ |
| Client.txt reading (new lines, truncation, UTF-8, replay, **resume after restart**) | LogTailer | service restart | ✓ |
| Finding Client.txt (Steam libraries) | misc | — | — |
| Map tracking (pause in hideout, portals, new instance, timeout, game restart, deaths) | RunTracker | service | ✓ |
| Boss arenas as attempts | RunTracker | service | ✓ |
| Area classification | misc | — | — |
| 200 000-line log performance | misc | — | — |
| Database: schema, **upgrade from older versions** | RunRepository, misc | service restart | — |
| Prices: poe.ninja exchange + stash (tablets, uniques), 1 h cache, offline fallback, league retry | pricing, Economy | service | ✓ (live in test:live) |
| Strategies: cost per map, auto-applied to maps only, re-apply, delete | Economy | service | ✓ |
| Loot, investment, profit, profit/hour, values frozen | Economy | service | ✓ |
| Sessions: rush objective, boss kill/fail, hideout crafting, history, rates hidden < 5 min | SessionRepository | service | ✓ |
| Build import / re-import / other character / bad codes | BuildRepository | bridge, service, robustness | ✓ |
| Item comparison (compare shortcut: one clipboard read per press, equipment only, misses reported, bad copies) | compareHotkey | bridge, service, robustness | ✓ |
| "I equipped it" → new version, real quality kept | — | bridge, service | ✓ |
| Versions linked to maps, results per version | BuildRepository | service | ✓ |
| Gear check | gearCheck | bridge, service | ✓ |
| Trade upgrade search: PoB weights per slot, required / excluded stats, max price, preview, trade URL, resistance loss warning | tradeQuery | bridge, service | ✓ (URL checked) |
| Guide: gear, tree, gems, unique prices | targetCompare, treeGemsCompare | bridge, service | ✓ |
| Engine queue (guide reading never swaps the player build) | — | service | — |
| Engine crash → restart with the player build | — | service | — |
| Engine missing → tracking still works | — | robustness | — |
| Settings, build, strategies, session kept after restart | — | service restart | — |
| Display formats | misc | — | ✓ |
| Tabs, navigation, shortcut from another tab shows a notice | — | — | ✓ |
| Interface language (English / French), settings panel | i18n | — | ✓ (switch to French and back) |
| Windows installer, packaged engine | — | Windows CI | Windows CI |

## Not covered automatically (needs the real game)

- Real PoE 2 Client.txt format (patterns written from PoE 1 + docs; to check on a real log)
- Ctrl+C text copied by the PoE 2 client (format assumed from PoB's parser)
- Map completion / boss kill lines, pinnacle arena area ids

## Network budget (poe.ninja)

The app makes automatic HTTP requests to **poe.ninja only** (no GGG API, no trade API).
`tests/unit/ninjaBudget.test.ts` enforces it:

- one request per price category per hour at most (22 categories), plus the league list once a day;
- requests are queued one at a time, 1.5 s apart; identical requests in flight are merged;
- conditional requests (`If-None-Match`): an unchanged category returns `304`, with no body;
- `429` → pause for `Retry-After` (or 1 h); `401/403` → 6 h; network/5xx → 10 min. During a pause,
  saved prices are served and **nothing** is sent; a refresh stops at the first refusal;
- the app runs as a single instance (a second launch focuses the first window);
- "Open trade search" only opens the browser, with a 3 s cooldown.

The request count (last hour / 24 h) is shown in the tooltip of the price indicator in the header.

## Loot filter and price checkers

- `tests/unit/lootFilter.test.ts`: filter syntax and first-match rules (`Continue`, area level,
  operators), on hand-written rules and on two real NeverSink PoE 2 filters (MIT, test fixtures);
  detection of the filter selected in game (`item_filter=` in the config .ini, `OnlineFilters`),
  fallback on the most recent `.filter`.
- `tests/pob/TrackerService.test.ts` ("loot filter"): priced items hidden by the player's filter,
  threshold in exalted, manual choice of the file.
- GGG overlay rules: "Reading from the screen or clipboard may only be performed once per manual key
  press." The app never watches the clipboard: the compare shortcut (default Ctrl+Shift+C, global,
  configurable) reads it once. Only equipment is compared (`isGearText`), anything else is reported to
  the player. PoB reads the advanced copy (Ctrl+Alt+C) the same way. The e2e test triggers the same code
  path with `app.emit('compare-hotkey')`.
- The loot filter is read only after the player clicks "Analyse my loot filter" (`lootFilterConsent`).
- E2E: `POE2_FILTER_DIR` points the app at a test folder holding the 6-UBER-PLUS-STRICT filter.

⚠️ To verify on a real Windows install: the exact config .ini name and how followed (online) filters
are cached. Until then the player can pick the file in Maps → Loot filter.

## Verdicts

Rule-based observations (`src/core/verdicts/verdicts.ts`), shown on the Dashboard. Pure functions, no
AI, no network. `tests/unit/verdicts.test.ts` checks each rule and its minimum sample:

| Area | Rule | Minimum data |
|---|---|---|
| Maps | ≥ 25 % of maps with a death (names the worst map) / no death | 8 maps / 16 maps |
| Maps | a map takes ≥ 1.5× the median map time | 3 runs of that map, 2 maps compared |
| Economy | loot declared on < 30 % of maps | 8 maps |
| Economy | most profitable map / strategy (profit/h gap ≥ 30 %) | 3 runs with loot per group |
| Build versions | maps ≥ 10 % faster or slower, +15 pts of maps with a death | 5 maps per version |
| Bosses | kill rate < 50 % / every attempt killed | 3 attempts / 5 attempts |
| Build | elemental res < 75 %, chaos res < 0 (endgame), one max hit < 60 % of the others, movement speed < +10 % (endgame), ≥ 30 Spirit unused, easy gear fixes | an imported build |

The smoke test checks them on the real engine; the e2e test checks the card and its link to the Build tab.

## Gear advice (Build tab)

All numbers come from Path of Building; `src/shared/impact.ts` turns a stat difference into plain sentences
and one score (damage % + effective HP % + resistance fixes, the 75% cap weighs most).

| Feature | How | Tests |
|---|---|---|
| Comparison verdict | `itemVerdict`: upgrade / downgrade / trade-off, never recommends losing a resistance cap; damage-for-defence weighed with the player's death rate (30 days, ≥ 8 maps) | `impact.test.ts`, service |
| Runes & soul cores | bridge `rune_options`: every rune PoB allows on the item (`GetValidRunesForItem`, level ≤ character) in the empty sockets; ranked, priced (poe.ninja), "best value" = cheapest with ≥ 80% of the best gain | `gearAdvice.test.ts`, service (armour with 2 sockets) |
| What to upgrade first | per slot: trade weights (PoB) → a good realistic rare = current defences (resistances, life, ES) + the most useful other stats at PoB's tested value, ≤ 6 lines → `trade_preview` gain; cached per build version | `gearAdvice.test.ts`, service, e2e |
| Items line by line | bridge `mod_impact`: each implicit/explicit line removed from the item text, recalculated; weakest non-resistance line flagged when ≤ 25% of the best | `gearAdvice.test.ts`, service, e2e |
| Glossary | `STAT_HELP` hover text on every stat label | — |

Note: an item copied in game lists `Sockets:` before `Item Level:`; PoB reads a `Sockets:` line placed after it
as a mod (and doubles the sockets on reload). Test items follow the game's order.

## Optimisations (passive tree & supports)

On demand from the Build tab (≈ 1–3 s), cached per build version; the best pick also appears in the
Dashboard verdicts once calculated.

| Part | How (Path of Building) | Rules |
|---|---|---|
| Best next points | bridge `tree_options`: every unallocated node within 5 points, calculated with its path (`addNodes`) | ranked by gain per point; the same small passive kept only at its closest |
| Least useful points | allocated nodes removable with their dependents (≤ 4 points, `removeNodes`) | ranked by loss per point |
| Respec ideas | bridge `tree_swap`: remove + add calculated together | removal frees enough points, is not on the new path, loses less than the add gains |
| Supports | bridge `support_options`: each current support disabled → its value; each compatible support (`calcLib.canGrantedEffectSupportActiveSkill`) not used elsewhere added → its gain; best candidates tried in place of each support | PoE 2: one copy of each support per character; best of each family (same family = replaces it); Lineage marked and priced; supports that lower or don't change PoB's single-target numbers (e.g. Multishot) are explained, never proposed for replacement |

Tests: `tests/unit/optimisations.test.ts`; engine test on a Lightning Arrow build with a bow equipped (without a
bow the skill deals no damage and no support changes anything); e2e (card, clear message for a build with no gem).

### Passive points, mana and Spirit

- **Unspent points**: bridge `passive_points`, Path of Building's own counting: available = level − 1 + all quest
  points + bonus points (weapon set points apart). Only claimed once the character is past the last quest giving
  points (`campaignLevel`); when PoB estimates the level from the points used, there is never a false "unspent".
  Shown in Optimisations and as a verdict. Engine test: the same tree at a fixed level 80 → 103 available, 15 used.
- **Supports suggested**: support gems have no attribute requirement in PoE 2 (PoB: `getGemStatRequirement`
  returns 0 for supports). Their costs are checked: mana per use, how long the mana lasts using the main skill
  non-stop (`ManaPerSecondCost` vs `ManaRegenRecovery`, warning under 20 s), Spirit going negative.
- **Verdict**: the main skill runs out of mana in under 20 s of non-stop use (warning under 10 s).

## Translations (English / French)

- Texts are written in English and wrapped in `t('…')` (renderer: `useT()`; main process: `svc.t`; core
  functions take a translator, English by default). `src/shared/i18n/fr.ts` maps each English text to French;
  a missing entry falls back to English.
- `tests/unit/i18n.test.ts` scans the source code: every `t('…')` text needs a French entry with the same
  `{parameters}`, and no French entry may be left unused. Rules for it to see the texts: a literal string
  inside `t(…)`, no template literal, plurals as two `t()` calls (`n === 1 ? t('{n} map', …) : t('{n} maps', …)`).
- Results calculated on the server (verdicts, gear advice, optimisations, gear check) are cached per build
  version **and** language; screens reload them when the language changes.
- Game data (item mods, item and gem names, PoB stat lines) stays in English, as in Path of Building and on
  the trade site; so do currency names (Exalted Orb, Artificer's Orb…).
- English is the default language; French is chosen in Settings (`POE2_LANG` only forces the default, for tests).
- The e2e test runs in English (`POE2_LANG=en`) and checks the switch to French and back. Dates and numbers
  follow the system locale.
