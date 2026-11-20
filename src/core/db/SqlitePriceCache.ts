import type { DatabaseSync } from 'node:sqlite'
import type { PriceCache } from '../pricing/PoeNinjaClient'

export class SqlitePriceCache implements PriceCache {
  constructor(private readonly db: DatabaseSync) {}

  get(key: string): { payload: string; fetchedAt: number; etag: string | null } | null {
    const row = this.db.prepare('SELECT payload, fetched_at, etag FROM price_cache WHERE key = ?').get(key) as
      | { payload: string; fetched_at: number; etag: string | null }
      | undefined
    return row ? { payload: row.payload, fetchedAt: row.fetched_at, etag: row.etag } : null
  }

  set(key: string, payload: string, fetchedAt: number, etag: string | null = null): void {
    this.db
      .prepare(
        `INSERT INTO price_cache (key, payload, fetched_at, etag) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at, etag = excluded.etag`
      )
      .run(key, payload, fetchedAt, etag)
  }
}
