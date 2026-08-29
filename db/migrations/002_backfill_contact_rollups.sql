-- 002 — Backfill the CRM rollups on contacts from existing history so the
-- customer 360, lifecycle segments and reactivation targeting work against data
-- that predates migration 001. Idempotent: every column is recomputed, not
-- incremented. Runs per tenant so row-level security stays satisfied.

do $$
declare
  trec record;
begin
  for trec in select id from tenants loop
    perform set_config('app.current_tenant_id', trec.id::text, true);

    update contacts c set
      total_bookings     = sub.total,
      completed_bookings  = sub.completed,
      no_show_count       = sub.no_shows,
      first_booked_at     = sub.first_at,
      last_booked_at       = sub.last_at,
      lifetime_value_chf   = sub.ltv,
      last_interaction_at  = greatest(coalesce(c.last_interaction_at, '-infinity'::timestamptz), coalesce(sub.last_activity, '-infinity'::timestamptz)),
      last_interaction_kind = coalesce(c.last_interaction_kind, 'appointment'),
      lifecycle_stage = case
        when sub.completed >= 4 then 'vip'
        when sub.completed >= 1 and sub.last_at >= now() - interval '120 days' then 'active'
        when sub.completed >= 1 then 'inactive'
        else c.lifecycle_stage
      end
    from (
      select
        contact_id,
        count(*) filter (where status in ('booked', 'completed', 'no_show', 'cancelled')) as total,
        count(*) filter (where status = 'completed') as completed,
        count(*) filter (where status = 'no_show') as no_shows,
        min(starts_at) as first_at,
        max(starts_at) filter (where status in ('booked', 'completed')) as last_at,
        coalesce(sum(value_chf) filter (where status = 'completed'), 0) as ltv,
        max(greatest(starts_at, ends_at)) as last_activity
      from appointments
      where tenant_id = trec.id
      group by contact_id
    ) sub
    where sub.contact_id = c.id and c.tenant_id = trec.id;

    -- Latest call / message also counts as an interaction.
    update contacts c set
      last_interaction_at = greatest(coalesce(c.last_interaction_at, '-infinity'::timestamptz), sub.last_call)
    from (select contact_id, max(started_at) as last_call from calls where tenant_id = trec.id group by contact_id) sub
    where sub.contact_id = c.id and c.tenant_id = trec.id and sub.last_call is not null;

    update contacts c set
      last_interaction_at = greatest(coalesce(c.last_interaction_at, '-infinity'::timestamptz), sub.last_msg)
    from (
      select contact_id, max(coalesce(sent_at, created_at)) as last_msg
      from messages where tenant_id = trec.id and contact_id is not null group by contact_id
    ) sub
    where sub.contact_id = c.id and c.tenant_id = trec.id and sub.last_msg is not null;

    -- Contacts with a booking history but no explicit stage yet.
    update contacts set lifecycle_stage = 'active'
    where tenant_id = trec.id and lifecycle_stage = 'lead' and total_bookings > 0
      and last_booked_at >= now() - interval '120 days';
    update contacts set lifecycle_stage = 'inactive'
    where tenant_id = trec.id and lifecycle_stage = 'lead' and total_bookings > 0;
  end loop;
  perform set_config('app.current_tenant_id', '', true);
end $$;
