import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { DashboardApi } from "../api/src/dashboard-api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(here, "../dashboard/data/seed-dashboard.json");
const db = new PGlite({ extensions: { btree_gist } });

await db.exec(await readFile(path.join(here, "schema.sql"), "utf8"));
await db.exec(await readFile(path.join(here, "seed.sql"), "utf8"));

const tenant = (await db.query(`
  select id::text, slug, name, locale, timezone, currency, branding, contact_config,
         avg_appointment_value_chf::float8, baseline_no_show_rate::float8
  from tenants limit 1
`)).rows[0];
const kpis = (await db.query(`
  select kpi_date::text, bookings_count, calls_answered, calls_missed,
         appointments_due, no_shows, no_show_recoveries,
         leads_call, leads_instagram, leads_whatsapp, leads_website, leads_google,
         bookings_call, bookings_instagram, bookings_whatsapp, bookings_website, bookings_google,
         recovered_appointments, recovered_revenue_estimate_chf::float8,
         reviews_requested, reviews_received, rating_sum::float8, rating_count,
         average_rating::float8
  from kpi_daily order by kpi_date
`)).rows;

const api = new DashboardApi({ db });
const tenantId = tenant.id;
const u = (q = "") => new URL(`http://snapshot/?${q}`);
const [overview, upcoming, past, calls, leads, reviews, messages] = await Promise.all([
  api.overview(tenantId),
  api.appointments(tenantId, u("limit=200")),
  api.appointments(tenantId, u("scope=past&limit=200")),
  api.calls(tenantId, u("limit=200")),
  api.leads(tenantId, u("limit=200")),
  api.reviews(tenantId, u("limit=200")),
  api.messages(tenantId, u("limit=200"))
]);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({
  generatedAt: new Date().toISOString(), tenant, kpis, live: overview.live,
  appointments: { upcoming: upcoming.appointments, past: past.appointments },
  calls: calls.calls, leads: leads.leads, funnel: leads.funnel,
  reviews: reviews.reviews, complaints: reviews.complaints, messages: messages.messages
}, null, 2) + "\n");
console.log(`Wrote ${output} with ${kpis.length} KPI days`);
await db.close();
