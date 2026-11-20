export interface Migration {
  version: number
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE leagues (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        is_active   INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE builds (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );

      -- Every change (re-import, item swap) creates a new version; runs point to the active one.
      CREATE TABLE build_versions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        build_id    INTEGER NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
        created_at  TEXT NOT NULL,
        pob_code    TEXT NOT NULL,
        label       TEXT,
        stats_json  TEXT
      );

      CREATE TABLE runs (
        id              TEXT PRIMARY KEY,
        league_id       TEXT REFERENCES leagues(id),
        build_version_id INTEGER REFERENCES build_versions(id),
        area_id         TEXT NOT NULL,
        area_name       TEXT,
        area_level      INTEGER NOT NULL,
        seed            INTEGER NOT NULL,
        instance_ip     TEXT,
        started_at      TEXT NOT NULL,
        ended_at        TEXT,
        active_ms       INTEGER NOT NULL DEFAULT 0,
        deaths          INTEGER NOT NULL DEFAULT 0,
        reentries       INTEGER NOT NULL DEFAULT 0,
        end_reason      TEXT
      );
      CREATE INDEX idx_runs_started ON runs(started_at);

      -- Declared investment per run: waystone, tablets, other currency.
      CREATE TABLE run_investments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL CHECK (kind IN ('waystone', 'tablet', 'currency', 'other')),
        item_id     TEXT,
        label       TEXT NOT NULL,
        quantity    REAL NOT NULL DEFAULT 1,
        unit_value  REAL,               -- in the primary currency at declaration time
        currency    TEXT                -- primary currency of unit_value (e.g. 'divine')
      );

      -- Declared loot per run (quick entry).
      CREATE TABLE run_loot (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        item_id     TEXT,
        label       TEXT NOT NULL,
        quantity    REAL NOT NULL DEFAULT 1,
        unit_value  REAL,
        currency    TEXT
      );

      CREATE TABLE price_cache (
        key         TEXT PRIMARY KEY,   -- league|endpoint|type
        payload     TEXT NOT NULL,
        fetched_at  INTEGER NOT NULL    -- epoch ms
      );

      CREATE TABLE settings (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    sql: `
      -- Farming strategy = what you put in each map (waystone + tablets + other), reused run after run.
      CREATE TABLE strategy_presets (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        items_json  TEXT NOT NULL,      -- [{ kind, label, itemId?, quantity, manualValue? }]
        created_at  TEXT NOT NULL
      );
      ALTER TABLE runs ADD COLUMN strategy_id INTEGER REFERENCES strategy_presets(id);
    `
  },
  {
    version: 3,
    sql: `
      -- A play session with a farming mode and an objective.
      CREATE TABLE sessions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        mode            TEXT NOT NULL CHECK (mode IN ('maps', 'boss', 'hideout')),
        target_count    INTEGER,          -- maps: number of maps; boss: number of attempts (optional)
        boss_name       TEXT,             -- boss mode
        activity        TEXT,             -- hideout mode: 'stash' | 'craft'
        started_at      TEXT NOT NULL,
        ended_at        TEXT
      );
      CREATE INDEX idx_sessions_started ON sessions(started_at);

      ALTER TABLE runs ADD COLUMN session_id INTEGER REFERENCES sessions(id);
      ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'map';   -- 'map' | 'boss'
      ALTER TABLE runs ADD COLUMN outcome TEXT;                        -- boss: 'kill' | 'fail'

      -- Currency spent / gained outside maps (crafting, selling…), per session.
      CREATE TABLE session_lines (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        direction   TEXT NOT NULL CHECK (direction IN ('spent', 'gained')),
        item_id     TEXT,
        label       TEXT NOT NULL,
        quantity    REAL NOT NULL DEFAULT 1,
        unit_value  REAL,
        currency    TEXT
      );
    `
  },
  {
    version: 4,
    sql: `
      -- ETag of cached poe.ninja responses, for conditional requests (304 Not Modified).
      ALTER TABLE price_cache ADD COLUMN etag TEXT;
    `
  }
]
