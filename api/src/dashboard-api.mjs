// Read-only JSON API for the owner dashboard. The API process owns the database; the dashboard
// is a client. Authenticated with `authorization: Bearer <DASHBOARD_API_TOKEN>`.
const clamp = (n, lo, hi, d) => { if (n === null || n === undefined || n === "") return d; const v = Number(n); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };

export class DashboardApi {
  constructor({ db }) { this.db = db; }

  async overview(tenantId) {
    const tenant = (await this.db.query(`
      select id::text, slug, name, locale, timezone, currency, branding, contact_config,
             avg_appointment_value_chf::float8, baseline_no_show_rate::float8
      from tenants where id = $1::uuid`, [tenantId])).rows[0];
    const kpis = (await this.db.query(`
      select kpi_date::text, bookings_count, calls_answered, calls_missed, appointments_due, no_shows, no_show_recoveries,
             leads_call, leads_instagram, leads_whatsapp, leads_website, leads_google,
             bookings_call, bookings_instagram, bookings_whatsapp, bookings_website, bookings_google,
             recovered_appointments, recovered_revenue_estimate_chf::float8, reviews_requested, reviews_received,
             rating_sum::float8, rating_count, average_rating::float8
      from kpi_daily where tenant_id = $1::uuid order by kpi_date`, [tenantId])).rows;
    const live = (await this.db.query(`
      select
        (select count(*)::int from appointments where tenant_id = $1::uuid and status = 'booked' and starts_at >= now()) as upcoming_appointments,
        (select count(*)::int from appointments where tenant_id = $1::uuid and status = 'booked' and (starts_at at time zone t.timezone)::date = (now() at time zone t.timezone)::date) as today_appointments,
        (select count(*)::int from leads where tenant_id = $1::uuid and status in ('new','contacted','qualified')) as open_leads,
        (select count(*)::int from complaints where tenant_id = $1::uuid and resolved_at is null) as open_complaints,
        (select count(*)::int from messages where tenant_id = $1::uuid and delivery_status = 'queued') as queued_messages,
        (select count(*)::int from calls where tenant_id = $1::uuid and started_at >= now() - interval '7 days') as calls_7d
      from tenants t where t.id = $1::uuid`, [tenantId])).rows[0];
    return { tenant, kpis, live, generatedAt: new Date().toISOString() };
  }

  async appointments(tenantId, url) {
    const limit = clamp(url.searchParams.get("limit"), 1, 500, 100);
    const scope = url.searchParams.get("scope") === "past" ? "a.starts_at < now()" : "a.starts_at >= now() - interval '1 day'";
    const rows = (await this.db.query(`
      select a.id::text, a.status, a.status_source, a.starts_at, a.ends_at, a.service, a.value_chf::float8, a.staff, a.lead_source,
             a.recovered_from_no_show_id::text, c.first_name, c.last_name, c.phone_e164, c.email
      from appointments a join contacts c on c.id = a.contact_id
      where a.tenant_id = $1::uuid and ${scope}
      order by a.starts_at ${scope.startsWith("a.starts_at <") ? "desc" : "asc"} limit $2`, [tenantId, limit])).rows;
    return { appointments: rows };
  }

  async calls(tenantId, url) {
    const limit = clamp(url.searchParams.get("limit"), 1, 500, 100);
    const rows = (await this.db.query(`
      select k.id::text, k.retell_call_id, k.started_at, k.duration_seconds, k.answered, k.outcome, k.disclosure_played,
             k.transcript, k.recording_url, c.first_name, c.phone_e164
      from calls k left join contacts c on c.id = k.contact_id
      where k.tenant_id = $1::uuid order by k.started_at desc limit $2`, [tenantId, limit])).rows;
    return { calls: rows };
  }

  async leads(tenantId, url) {
    const limit = clamp(url.searchParams.get("limit"), 1, 500, 200);
    const status = url.searchParams.get("status");
    const rows = (await this.db.query(`
      select l.id::text, l.source, l.channel, l.service_interest, l.urgency, l.preferred_time, l.notes, l.status,
             l.booked_appointment_id::text, l.created_at, l.updated_at,
             c.id::text as contact_id, c.first_name, c.last_name, c.phone_e164, c.email, c.manychat_subscriber_id,
             (select count(*)::int from messages m where m.contact_id = c.id and m.template_id like 'lead_%' and m.delivery_status in ('sent','stubbed')) as follow_ups_sent,
             (select min(scheduled_for) from messages m where m.contact_id = c.id and m.template_id like 'lead_%' and m.delivery_status = 'queued') as next_follow_up_at
      from leads l join contacts c on c.id = l.contact_id
      where l.tenant_id = $1::uuid and ($3::text is null or l.status = $3)
      order by l.created_at desc limit $2`, [tenantId, limit, status])).rows;
    const funnel = (await this.db.query(`
      select status, count(*)::int as count from leads where tenant_id = $1::uuid group by status`, [tenantId])).rows;
    return { leads: rows, funnel };
  }

  async reviews(tenantId, url) {
    const limit = clamp(url.searchParams.get("limit"), 1, 500, 100);
    const rows = (await this.db.query(`
      select r.id::text, r.requested_at, r.rating, r.routed_to, r.received_at, r.gbp_review_id, r.private_feedback,
             c.first_name, a.service, a.staff
      from reviews r left join contacts c on c.id = r.contact_id left join appointments a on a.id = r.appointment_id
      where r.tenant_id = $1::uuid order by r.requested_at desc limit $2`, [tenantId, limit])).rows;
    const complaints = (await this.db.query(`
      select k.id::text, k.source_channel, k.detected_category, k.severity, k.body, k.notified_at, k.resolved_at, k.created_at, c.first_name, c.phone_e164
      from complaints k left join contacts c on c.id = k.contact_id
      where k.tenant_id = $1::uuid order by k.created_at desc limit 100`, [tenantId])).rows;
    return { reviews: rows, complaints };
  }

  async messages(tenantId, url) {
    const limit = clamp(url.searchParams.get("limit"), 1, 500, 150);
    const rows = (await this.db.query(`
      select m.id::text, m.channel, m.direction, m.body, m.template_id, m.delivery_status, m.scheduled_for, m.sent_at, m.created_at,
             c.first_name, c.phone_e164, c.email
      from messages m left join contacts c on c.id = m.contact_id
      where m.tenant_id = $1::uuid order by coalesce(m.sent_at, m.scheduled_for, m.created_at) desc limit $2`, [tenantId, limit])).rows;
    return { messages: rows };
  }
}

export const DASHBOARD_ROUTES = new Map([
  ["/api/dashboard/overview", "overview"],
  ["/api/dashboard/appointments", "appointments"],
  ["/api/dashboard/calls", "calls"],
  ["/api/dashboard/leads", "leads"],
  ["/api/dashboard/reviews", "reviews"],
  ["/api/dashboard/messages", "messages"]
]);
