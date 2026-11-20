# Third-party notices

PoE2 Tracker ships the following third-party software in `resources/engine/`.

## Path of Building Community (PoE 2)

- Source: https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2 (version in `engine/engine.json`)
- Licence: MIT — Copyright (c) David Gowor and the Path of Building Community. Full text in `engine/pob/LICENSE.md`.
- Shipped unmodified, without its image assets. PoE2 Tracker is not affiliated with the Path of Building Community.
- `runtime/lua/base64.lua` is distributed under its own licence (LGPL) and is not modified.

## LuaJIT

- Source: https://github.com/LuaJIT/LuaJIT (commit in `engine/engine.json`)
- Licence: MIT — Copyright (C) 2005-2026 Mike Pall.

## lua-utf8 (luautf8)

- Source: https://github.com/starwing/luautf8 — Licence: MIT.

## zlib (Windows)

- https://zlib.net — zlib licence.

## Microsoft Visual C++ runtime (Windows)

- `vcruntime140*.dll`, `msvcp140.dll`, redistributed as permitted by the Visual Studio redistribution terms.

## NeverSink's filter for PoE 2 (test fixtures only)

Two filter files (3-STRICT, 6-UBER-PLUS-STRICT, version 0.10.4) from
https://github.com/NeverSinkDev/NeverSink-Filter-for-PoE2 are used, unmodified, as test data in
`tests/fixtures/filters/`. MIT License, Copyright (c) 2026 NeverSink — see
`tests/fixtures/filters/NEVERSINK-LICENSE`. They are not shipped with the app: the app only
reads the player's own filter.

## Electron, React and npm dependencies

- Licences listed in each package; Electron's `LICENSES.chromium.html` ships with the app.

Path of Exile is a trademark of Grinding Gear Games. This product isn't affiliated with or endorsed by Grinding Gear Games in any way.
