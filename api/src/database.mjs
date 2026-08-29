import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import pg from "pg";
import { runMigrations } from "../../db/migrate-runner.mjs";

const { Pool } = pg;
const tenantId = "11111111-1111-4111-8111-111111111111";

function integerSetting(value, fallback, { min = 1, max = 100 } = {}) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function structuredLog(logger, level, event, details = {}) {
  const sink = logger?.[level] ?? logger?.log;
  if (!sink) return;
  sink.call(logger, JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details
  }));
}

export function postgresPoolConfig(databaseUrl, env = process.env) {
  let urlSslMode;
  try {
    urlSslMode = new URL(databaseUrl).searchParams.get("sslmode") ?? undefined;
  } catch {
    urlSslMode = undefined;
  }
  const sslSetting = String(env.DATABASE_SSL ?? env.PGSSLMODE ?? urlSslMode ?? "require").toLowerCase();
  const certificateAuthority = env.DATABASE_SSL_CA
    ?? (env.DATABASE_SSL_CA_BASE64
      ? Buffer.from(env.DATABASE_SSL_CA_BASE64, "base64").toString("utf8")
      : undefined);
  const verifyCertificate = ["verify-ca", "verify-full"].includes(sslSetting)
    || String(env.DATABASE_SSL_REJECT_UNAUTHORIZED ?? "false").toLowerCase() === "true";
  if (["verify-ca", "verify-full"].includes(sslSetting) && !certificateAuthority) {
    throw new Error(
      `DATABASE_SSL=${sslSetting} requires the Supabase CA certificate in DATABASE_SSL_CA or DATABASE_SSL_CA_BASE64.`
    );
  }
  const ssl = ["disable", "false", "0", "off"].includes(sslSetting)
    ? false
    : {
        rejectUnauthorized: verifyCertificate,
        ...(certificateAuthority ? { ca: certificateAuthority } : {})
      };

  return {
    connectionString: databaseUrl,
    ssl,
    max: integerSetting(env.DATABASE_POOL_MAX, 10, { max: 50 }),
    idleTimeoutMillis: integerSetting(env.DATABASE_POOL_IDLE_MS, 30_000, { min: 1_000, max: 600_000 }),
    connectionTimeoutMillis: integerSetting(env.DATABASE_CONNECT_TIMEOUT_MS, 10_000, { min: 1_000, max: 120_000 }),
    application_name: env.DATABASE_APPLICATION_NAME ?? "wa-aios-api"
  };
}

class PostgresDatabase {
  constructor(pool, { currentTenantId = tenantId } = {}) {
    this.pool = pool;
    this.driver = "postgres";
    this.currentTenantId = currentTenantId;
  }

  async prepare(client) {
    await client.query("select set_config('app.current_tenant_id', $1, false)", [this.currentTenantId]);
  }

  async query(text, values) {
    const client = await this.pool.connect();
    try {
      await this.prepare(client);
      return await client.query(text, values);
    } finally {
      client.release();
    }
  }

  async exec(sql) {
    return this.query(sql);
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this.prepare(client);
      const transactionClient = {
        driver: this.driver,
        query: (text, values) => client.query(text, values),
        exec: (sql) => client.query(sql)
      };
      const result = await callback(transactionClient);
      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original database error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

class PGliteDatabase {
  constructor(database) {
    this.database = database;
    this.driver = "pglite";
  }

  query(text, values) {
    return this.database.query(text, values);
  }

  exec(sql) {
    return this.database.exec(sql);
  }

  transaction(callback) {
    return this.database.transaction(async (transaction) => callback({
      driver: this.driver,
      query: (text, values) => transaction.query(text, values),
      exec: (sql) => transaction.exec(sql)
    }));
  }

  close() {
    return this.database.close();
  }
}

async function verifyConcurrencyGuarantees(db) {
  const extension = await db.query("select 1 from pg_extension where extname = 'btree_gist'");
  if (!extension.rows.length) {
    throw new Error(
      "btree_gist is not enabled. Refusing to start because overlapping booking protection would be weakened. Run npm run migrate with an extension-capable Postgres role."
    );
  }

  const constraints = await db.query(`
    select c.conrelid::regclass::text as table_name
    from pg_constraint c
    where c.contype = 'x'
      and c.conrelid in (
        'appointments'::regclass,
        'booking_slot_locks'::regclass,
        'local_calendar_events'::regclass
      )
  `);
  const protectedTables = new Set(constraints.rows.map((row) => row.table_name));
  const missing = ["appointments", "booking_slot_locks", "local_calendar_events"]
    .filter((table) => !protectedTables.has(table));
  if (missing.length) {
    throw new Error(
      `Refusing to start without exclusion-based concurrency protection. Missing exclusion constraints on: ${missing.join(", ")}.`
    );
  }
}

async function seedLocalDatabase(db, seed) {
  const table = await db.query("select to_regclass('public.tenants')::text as name");
  let seeded = false;
  if (!table.rows[0]?.name) {
    const schema = await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8");
    await db.exec(schema);
    if (seed) {
      const seedSql = await readFile(new URL("../../db/seed.sql", import.meta.url), "utf8");
      await db.exec(seedSql);
      seeded = true;
    }
  }
  return seeded;
}

export async function openDatabase({
  dataDir,
  seed = true,
  databaseUrl,
  env = process.env,
  logger = console
} = {}) {
  let db;
  let seeded = false;

  if (databaseUrl) {
    const pool = new Pool(postgresPoolConfig(databaseUrl, env));
    pool.on("error", (error) => {
      structuredLog(logger, "error", "database_pool_error", { message: error.message });
    });
    db = new PostgresDatabase(pool, { currentTenantId: env.TENANT_ID ?? tenantId });
    try {
      const table = await db.query("select to_regclass('public.tenants')::text as name");
      if (!table.rows[0]?.name) {
        throw new Error("The Postgres schema is not installed. Run npm run migrate before starting the API.");
      }
      await verifyConcurrencyGuarantees(db);
      await runMigrations(db, { logger });
    } catch (error) {
      await db.close();
      throw error;
    }
  } else {
    if (dataDir) await mkdir(path.resolve(dataDir), { recursive: true });
    const database = dataDir
      ? new PGlite(path.resolve(dataDir), { extensions: { btree_gist } })
      : new PGlite({ extensions: { btree_gist } });
    await database.waitReady;
    db = new PGliteDatabase(database);
    seeded = await seedLocalDatabase(db, seed);
    await verifyConcurrencyGuarantees(db);
    await runMigrations(db, { logger });
  }

  await db.query("select set_config('app.current_tenant_id', $1, false)", [env.TENANT_ID ?? tenantId]);
  await db.query(`
    insert into local_calendar_events (
      tenant_id, external_id, calendar_id, starts_at, ends_at, summary, description
    )
    select
      tenant_id,
      external_id,
      staff_calendar_id,
      starts_at,
      ends_at,
      service || ' - ' || staff,
      'Imported from canonical seeded appointment'
    from appointments
    where status in ('reserved', 'booked') and external_id is not null
    on conflict (tenant_id, external_id) do nothing
  `);

  structuredLog(logger, "info", "database_driver_active", {
    driver: db.driver,
    pooled: db.driver === "postgres",
    tls: db.driver === "postgres" ? postgresPoolConfig(databaseUrl, env).ssl !== false : false
  });
  return { db, driver: db.driver, seeded };
}

export const DEFAULT_TENANT_ID = tenantId;

export function jsonValue(value, fallback) {
  if (value == null) return fallback;
  return typeof value === "string" ? JSON.parse(value) : value;
}
