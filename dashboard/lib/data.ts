import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import type { DashboardData, KpiDay, Tenant } from "./types";

const tenantId = process.env.NEXT_PUBLIC_DEMO_TENANT_ID || "11111111-1111-4111-8111-111111111111";

function normalizeKpi(row: Record<string, unknown>): KpiDay {
  const numeric = [
    "bookings_count", "calls_answered", "calls_missed", "appointments_due", "no_shows",
    "no_show_recoveries", "leads_call", "leads_instagram", "leads_whatsapp", "leads_website",
    "leads_google", "bookings_call", "bookings_instagram", "bookings_whatsapp", "bookings_website",
    "bookings_google", "recovered_appointments", "recovered_revenue_estimate_chf", "reviews_requested",
    "reviews_received", "rating_sum", "rating_count"
  ];
  const normalized = { ...row } as Record<string, unknown>;
  for (const key of numeric) normalized[key] = Number(row[key] || 0);
  normalized.average_rating = row.average_rating == null ? null : Number(row.average_rating);
  normalized.kpi_date = String(row.kpi_date).slice(0, 10);
  return normalized as KpiDay;
}

async function fromPostgres(): Promise<DashboardData> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    max: 2
  });
  try {
    const tenantResult = await pool.query<Tenant>(`
      select id::text, slug, name, locale, timezone, currency, branding, contact_config,
             avg_appointment_value_chf::float8, baseline_no_show_rate::float8
      from tenants where id = $1::uuid limit 1
    `, [tenantId]);
    if (!tenantResult.rows[0]) throw new Error(`Tenant ${tenantId} not found`);
    const kpiResult = await pool.query(`
      select kpi_date::text, bookings_count, calls_answered, calls_missed,
             appointments_due, no_shows, no_show_recoveries,
             leads_call, leads_instagram, leads_whatsapp, leads_website, leads_google,
             bookings_call, bookings_instagram, bookings_whatsapp, bookings_website, bookings_google,
             recovered_appointments, recovered_revenue_estimate_chf::float8,
             reviews_requested, reviews_received, rating_sum::float8, rating_count,
             average_rating::float8
      from kpi_daily where tenant_id = $1::uuid order by kpi_date
    `, [tenantId]);
    return { source: "postgres", tenant: tenantResult.rows[0], kpis: kpiResult.rows.map(normalizeKpi) };
  } finally {
    await pool.end();
  }
}

async function fromSeedSnapshot(): Promise<DashboardData> {
  console.warn("[WA AIOS DEMO] DATABASE_URL is not set. Rendering the dashboard from the snapshot generated from db/seed.sql.");
  const file = path.join(process.cwd(), "data", "seed-dashboard.json");
  const parsed = JSON.parse(await readFile(file, "utf8"));
  return {
    source: "seed-snapshot",
    generatedAt: parsed.generatedAt,
    tenant: parsed.tenant,
    kpis: parsed.kpis.map(normalizeKpi)
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  return process.env.DATABASE_URL ? fromPostgres() : fromSeedSnapshot();
}
