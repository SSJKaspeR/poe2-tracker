# Path of Building engine (headless)

PoE2 Tracker uses the [Path of Building Community (PoE 2)](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)
engine for every number it shows about a build. **The engine calculates; the app (and the optional AI) only explains.**

## How it works

```
Electron main ──spawn──▶ LuaJIT ─ resources/pob/bridge.lua
      ▲                         └─ dofile(PoB src/HeadlessWrapper.lua)   (PoB unmodified)
      └──── newline-delimited JSON on stdin/stdout ("@@POB@@" prefix) ────┘
```

- PoB is **not modified and not vendored** in this repo. It is fetched from the official repository/releases.
- `bridge.lua` is our own code (MIT). It:
  - redirects PoB's console output to stderr so stdout stays a clean protocol channel;
  - provides real `Inflate`/`Deflate` through LuaJIT FFI + zlib (the headless stubs return empty strings),
    which makes build codes work;
  - exposes commands: `ping`, `new_build`, `load_code`, `load_xml`, `export_code`, `export_xml`, `stats`,
    `compare_item`, `compare_node`.
- Item and node comparisons use PoB's own `GetMiscCalculator()` — the same path PoB's tooltips use.

## Engine pack

`npm run build:engine` (scripts/build-engine-pack.mjs) builds `build/engine/`, shipped in the installer as
`resources/engine/`:

- `pob/` — Path of Building at the release pinned in `engine.json` (currently PoE 2 `v0.23.1`), unmodified,
  **without images** (tree art, gem icons: ≈ 340 MB the headless engine never reads). ≈ 48 MB.
- `bin/luajit(.exe)` — LuaJIT at the commit PoB uses (supports `+=`). On Windows also `lua51.dll`, and
  `zlib1.dll` + MSVC runtime taken from PoB's own Windows runtime.
- `clibs/lua-utf8` — from PoB's runtime on Windows, built from source elsewhere.

The app looks for the engine in: `$POB_ENGINE_DIR`, `resources/engine` (installed app), `build/engine`, then `.pob`
(`npm run setup:pob`, dev).

Note: the PoE 2 repository also carries the old PoE 1 tags (`v2.x`). PoE 2 releases are `v0.x`.

`bridge.lua` supports both item constructors PoB has used (`new("Item", raw)` and `new("Item"):Item(raw)`).

## Updating PoB

Change `pob.ref` in `engine.json`, run `npm run build:engine && npm run test:pob`. PoB 1.0 support is expected
after December 11: a new installer will ship the updated engine (automatic engine updates: to do).

## Licence

Path of Building is MIT-licensed (© David Gowor / PoB Community). We keep its copyright and licence notices when
distributing it, do not modify `runtime/lua/base64.lua` (LGPL), and credit PoB visibly in the app. "Path of Building"
is not used as the name of this product.
