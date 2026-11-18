import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations'

/**
 * Local SQLite storage (Node's built-in `node:sqlite`, no native module to
 * rebuild for Electron).
 */
export class AppDatabase {
  readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
    const row = this.db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }
    const current = row.v ?? 0
    for (const m of MIGRATIONS) {
      if (m.version > current) {
        this.db.exec('BEGIN')
        try {
          this.db.exec(m.sql)
          this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(m.version)
          this.db.exec('COMMIT')
        } catch (err) {
          this.db.exec('ROLLBACK')
          throw err
        }
      }
    }
  }

  close(): void {
    this.db.close()
  }
}
