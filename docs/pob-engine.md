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

## Requirements

- **LuaJIT at the commit PoB pins** (`2460b3ff…`, July 2026). PoB's code uses compound assignment (`x += 1`),
  which older LuaJIT builds (e.g. distro packages) reject.
- `lua-utf8` native module.
- zlib (`libz` on Linux; `zlib1.dll`/`z.dll` on Windows — PoB's runtime ships one).

## Dev setup (Linux / macOS)

```bash
npm run setup:pob     # clones PoB, builds LuaJIT + lua-utf8 into .pob/
npm run test:pob      # integration tests against the real engine
```

## Windows (to do before release)

- Build `luajit.exe` + `lua51.dll` (same commit) and `lua-utf8.dll` in CI (GitHub Actions, `windows-latest`, MSVC).
- Ship them with the installer under `resources/pob-runtime/`.
- On first launch, download the PoB release zip, verify it, and extract `src/` + `runtime/lua/` to the user data folder.
  Update it when a new PoB release is published (PoB 1.0 support will land after Dec 11).

## Licence

Path of Building is MIT-licensed (© David Gowor / PoB Community). We keep its copyright and licence notices when
distributing it, do not modify `runtime/lua/base64.lua` (LGPL), and credit PoB visibly in the app. "Path of Building"
is not used as the name of this product.
