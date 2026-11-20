# Testing

| Suite | Command | What it covers | Where it runs |
|---|---|---|---|
| Unit | `npm test` | Pure logic, no engine (71 tests) | Linux CI, Windows CI |
| Engine + service | `npm run test:pob` | Real Path of Building engine, the whole service with a real database and Client.txt, robustness (27 tests) | Linux CI, Windows CI (Windows engine) |
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
