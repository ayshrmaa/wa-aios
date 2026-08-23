import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const db = new PGlite({ extensions: { btree_gist } });
const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
const seed = await readFile(new URL("./seed.sql", import.meta.url), "utf8");

await db.exec(schema);
await db.exec(seed);

const expectedTenant = "11111111-1111-4111-8111-111111111111";
await db.exec(`select set_config('app.current_tenant_id', '${expectedTenant}', false)`);

const counts = await db.query(`
  select
    (select count(*)::int from contacts) as contacts,
    (select count(*)::int from appointments) as appointments,
    (select count(*)::int from calls) as calls,
    (select count(*)::int from reviews) as reviews,
    (select count(*)::int from kpi_daily) as kpi_days
`);

const consistency = await db.query(`
  select
    (select count(*)::int from appointments where status = 'no_show') as appointment_no_shows,
    (select coalesce(sum(no_shows), 0)::int from kpi_daily) as kpi_no_shows,
    (select count(distinct recovered_from_no_show_id)::int from appointments where recovered_from_no_show_id is not null and status in ('booked', 'completed')) as recovered_appointments,
    (select coalesce(sum(recovered_appointments), 0)::int from kpi_daily) as kpi_recovered,
    (select coalesce(sum(no_show_recoveries), 0)::int from kpi_daily) as kpi_no_show_recoveries,
    (select count(*)::int from reviews) as review_requests,
    (select coalesce(sum(reviews_requested), 0)::int from kpi_daily) as kpi_review_requests,
    (select count(*)::int from reviews where received_at is not null) as reviews_received,
    (select coalesce(sum(reviews_received), 0)::int from kpi_daily) as kpi_reviews_received
`);

const c = consistency.rows[0];
for (const [left, right] of [
  [c.appointment_no_shows, c.kpi_no_shows],
  [c.recovered_appointments, c.kpi_recovered],
  [c.recovered_appointments, c.kpi_no_show_recoveries],
  [c.review_requests, c.kpi_review_requests],
  [c.reviews_received, c.kpi_reviews_received]
]) {
  if (left !== right) throw new Error(`Seed inconsistency: ${left} !== ${right}`);
}

const invariantResult = await db.query(`
  select
    (
      select count(*)::int
      from kpi_daily k
      cross join lateral (values
        ('call', k.leads_call, k.bookings_call),
        ('instagram', k.leads_instagram, k.bookings_instagram),
        ('whatsapp', k.leads_whatsapp, k.bookings_whatsapp),
        ('website', k.leads_website, k.bookings_website),
        ('google', k.leads_google, k.bookings_google)
      ) source_metric(source, leads, bookings)
      where bookings > leads
    ) as source_conversion_over_100,
    (
      select count(*)::int
      from kpi_daily k
      join tenants t on t.id = k.tenant_id
      where k.recovered_revenue_estimate_chf
        <> k.no_show_recoveries * t.avg_appointment_value_chf
    ) as recovered_revenue_mismatches,
    (
      select count(*)::int
      from kpi_daily
      where recovered_appointments <> no_show_recoveries
    ) as recovered_count_mismatches,
    (
      select count(*)::int
      from kpi_daily
      where no_shows > appointments_due
    ) as no_shows_over_appointments_due
`);

const violations = invariantResult.rows[0];
for (const [assertion, violationCount] of Object.entries(violations)) {
  if (violationCount !== 0) {
    throw new Error(`Metric assertion failed: ${assertion} has ${violationCount} violation(s)`);
  }
}

console.log(JSON.stringify({
  counts: counts.rows[0],
  consistency: c,
  assertions: {
    source_conversion_at_most_100_percent: "PASS (0 violations)",
    recovered_revenue_equals_count_times_average_value: "PASS (0 violations)",
    recovery_tile_count_equals_revenue_count: "PASS (0 violations)",
    no_shows_do_not_exceed_appointments_due: "PASS (0 violations)"
  }
}, null, 2));
await db.close();
