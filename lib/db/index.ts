import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { SCHEMA_SQL } from "./schema";

export type DB = Database.Database;

/**
 * Default database path. Resolves under the project so local-first dev "just
 * works"; the directory is gitignored because persisted logs may contain secret
 * values printed by workflow steps. Override with DB_PATH (ideally outside the
 * repo) for shared deployments.
 */
export function defaultDbPath(): string {
  const fromEnv = process.env.DB_PATH;
  if (fromEnv) return fromEnv;
  return path.resolve(process.cwd(), "data", "act-web-ui.sqlite");
}

/** Open (and migrate) a SQLite database. Pass ":memory:" for fast tests. */
export function openDatabase(dbPath: string = defaultDbPath()): DB {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

let _db: DB | null = null;

/** Process-wide singleton connection (better-sqlite3 is synchronous, so a single
 * connection serializes all access safely within one Node process). */
export function getDb(): DB {
  if (!_db) _db = openDatabase();
  return _db;
}
