import { readFile } from "node:fs/promises";
import pg from "pg";
import { DEFAULT_TENANT_ID, postgresPoolConfig } from "../src/database.mjs";
import { runMigrations } from "../../db/migrate-runner.mjs";

const { Pool } = pg;

function log(event, details = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    event,
    ...details
  }));
}

function wantsSeed() {
  if (process.argv.includes("--seed")) return true;
  if (process.argv.includes("--no-seed")) return false;
  return ["1", "true", "yes", "on"].includes(String(process.env.MIGRATE_SEED ?? "").toLowerCase());
}

async function verifyConcurrencyGuarantees(client) {
  const extension = await client.query("select 1 from pg_extension where extname = 'btree_gist'");
  if (!extension.rows.length) {
    throw new Error("btree_gist was not enabled; the booking concurrency guarantee cannot be installed.");
  }
  const constraints = await client.query(`
    select c.conrelid::regclass::text as table_name
    from pg_constraint c
    where c.contype = 'x'
      and c.conrelid in (
        'appointments'::regclass,
        'booking_slot_locks'::regclass,
        'local_calendar_events'::regclass
      )
  `);
  const tables = new Set(constraints.rows.map((row) => row.table_name));
  const missing = ["appointments", "booking_slot_locks", "local_calendar_events"]
    .filter((table) => !tables.has(table));
  if (missing.length) {
    throw new Error(`Missing required exclusion constraints on: ${missing.join(", ")}.`);
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for npm run migrate. Local PGlite bootstraps itself automatically.");
  }

  const pool = new Pool({
    ...postgresPoolConfig(databaseUrl, process.env),
    max: 1,
    application_name: "wa-aios-migrate"
  });
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext('wa-aios-schema-bootstrap'))");
    try {
      try {
        await client.query("create extension if not exists btree_gist");
      } catch (error) {
        throw new Error(
          `Could not enable btree_gist. Migration stopped without weakening booking concurrency: ${error.message}`,
          { cause: error }
        );
      }

      const table = await client.query("select to_regclass('public.tenants')::text as name");
      if (!table.rows[0]?.name) {
        const schema = await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8");
        await client.query(schema);
        log("schema_applied", { source: "db/schema.sql" });
      } else {
        log("schema_already_present", { source: "db/schema.sql" });
      }

      await verifyConcurrencyGuarantees(client);
      log("concurrency_guarantees_verified", {
        extension: "btree_gist",
        exclusionConstraints: ["appointments", "booking_slot_locks", "local_calendar_events"]
      });

      const migrations = await runMigrations(
        { exec: (sql) => client.query(sql), query: (sql, params) => client.query(sql, params) },
        { logger: { info: (line) => console.log(line) } }
      );
      log("incremental_migrations_complete", { applied: migrations.applied, total: migrations.total });

      if (wantsSeed()) {
        await client.query("select set_config('app.current_tenant_id', $1, false)", [DEFAULT_TENANT_ID]);
        const existing = await client.query("select 1 from tenants where id = $1::uuid", [DEFAULT_TENANT_ID]);
        if (existing.rows.length) {
          log("seed_already_present", { tenantId: DEFAULT_TENANT_ID });
        } else {
          const seedSql = await readFile(new URL("../../db/seed.sql", import.meta.url), "utf8");
          await client.query(seedSql);
          log("seed_applied", { source: "db/seed.sql", tenantId: DEFAULT_TENANT_ID });
        }
      } else {
        log("seed_skipped", { hint: "Pass --seed or set MIGRATE_SEED=true to install demo data." });
      }
    } catch (error) {
      // schema.sql and seed.sql own their transactions. Ensure a failed script
      // does not leave the session aborted before the advisory lock is released.
      try {
        await client.query("rollback");
      } catch {
        // Preserve the migration error that triggered the rollback.
      }
      throw error;
    } finally {
      await client.query("select pg_advisory_unlock(hashtext('wa-aios-schema-bootstrap'))");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    event: "migration_failed",
    message: error.message
  }));
  process.exitCode = 1;
});
