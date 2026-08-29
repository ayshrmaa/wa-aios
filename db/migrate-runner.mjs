// Incremental, idempotent SQL migrations. Runs on top of db/schema.sql (which
// stays the canonical fresh-install schema). Every file in db/migrations/*.sql
// is applied once, in filename order, and recorded in schema_migrations.
//
// Used by:
//   - api/scripts/migrate.mjs  (production Postgres, raw pg client)
//   - api/src/database.mjs      (local PGlite, on every boot)
//
// A migration file must be safe to run against a database that already has the
// change (use `if not exists` / guarded `do $$` blocks). The runner still skips
// already-recorded versions; the guards are belt-and-braces for partial applies.

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);

function log(logger, event, details = {}) {
  const sink = logger?.info ?? logger?.log;
  if (!sink) return;
  sink.call(logger, JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event, ...details }));
}

export async function listMigrations() {
  let entries;
  try {
    entries = await readdir(MIGRATIONS_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ version: name.replace(/\.sql$/, ""), name, url: new URL(name, MIGRATIONS_DIR) }));
}

/**
 * @param {{ exec: (sql: string) => Promise<unknown>, query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }} db
 */
export async function runMigrations(db, { logger = console } = {}) {
  const exec = (sql) => (db.exec ? db.exec(sql) : db.query(sql));

  await exec(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  // schema_migrations is infrastructure, not tenant data — no RLS.

  const applied = new Set(
    (await db.query("select version from schema_migrations")).rows.map((row) => row.version)
  );
  const all = await listMigrations();
  const pending = all.filter((migration) => !applied.has(migration.version));

  if (!pending.length) {
    log(logger, "migrations_up_to_date", { count: all.length });
    return { applied: [], total: all.length };
  }

  const ran = [];
  for (const migration of pending) {
    const sql = await readFile(migration.url, "utf8");
    log(logger, "migration_applying", { version: migration.version });
    await exec(sql);
    await db.query("insert into schema_migrations (version) values ($1) on conflict do nothing", [migration.version]);
    ran.push(migration.version);
    log(logger, "migration_applied", { version: migration.version });
  }
  return { applied: ran, total: all.length };
}

// Allow `node db/migrate-runner.mjs` as a manual local dry run against PGlite.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { openDatabase } = await import("../api/src/database.mjs");
  const opened = await openDatabase({ dataDir: process.env.PGLITE_DATA_DIR ?? "./api/data/pglite", env: process.env });
  const result = await runMigrations(opened.db);
  console.log(JSON.stringify(result, null, 2));
  await opened.db.close();
}
