# Testing

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
| Item comparison (Ctrl+C, clipboard switch, bad copies, 100 in a burst) | ClipboardWatcher | bridge, service, robustness | ✓ |
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
| Tabs, navigation, Ctrl+C brings back the Dashboard | — | — | ✓ |
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
- Exiled Exchange 2 also copies items (Ctrl+D). Only equipment is compared (`isGearText`); the app
  shows a notice instead of switching tab. PoB reads the advanced copy (Ctrl+Alt+C) the same way.
- E2E: `POE2_FILTER_DIR` points the app at a test folder holding the 6-UBER-PLUS-STRICT filter.

⚠️ To verify on a real Windows install: the exact config .ini name and how followed (online) filters
are cached. Until then the player can pick the file in Maps → Loot filter.
