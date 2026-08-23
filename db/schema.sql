begin;

create extension if not exists btree_gist;

create or replace function app_current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('app.current_tenant_id', true),
      current_setting('request.jwt.claim.tenant_id', true)
    ),
    ''
  )::uuid
$$;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique,
  slug text not null unique,
  name text not null,
  legal_name text,
  locale text not null check (locale in ('de-CH', 'fr-CH', 'it-CH', 'en')),
  fallback_locale text not null default 'en',
  timezone text not null default 'Europe/Zurich',
  currency char(3) not null default 'CHF',
  branding jsonb not null default '{}'::jsonb,
  contact_config jsonb not null default '{}'::jsonb,
  avg_appointment_value_chf numeric(10,2) not null check (avg_appointment_value_chf >= 0),
  baseline_no_show_rate numeric(5,4) not null check (baseline_no_show_rate between 0 and 1),
  booking_tier text not null check (booking_tier in ('full', 'read_only', 'native')),
  adapter_config jsonb not null default '{}'::jsonb,
  quiet_hours jsonb not null default '{"start":"21:00","end":"08:00"}'::jsonb,
  review_config jsonb not null default '{}'::jsonb,
  messaging_config jsonb not null default '{"mode":"stub"}'::jsonb,
  links jsonb not null default '{}'::jsonb,
  services jsonb not null default '[]'::jsonb,
  ghl_location_id text,
  retell_agent_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_self_tenant check (tenant_id = id)
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  ghl_contact_id text,
  first_name text not null,
  last_name text,
  email text,
  phone_e164 text,
  whatsapp_consent boolean not null default false,
  email_consent boolean not null default false,
  sms_consent boolean not null default false,
  source text not null check (source in ('call', 'instagram', 'whatsapp', 'website', 'google')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, ghl_contact_id),
  unique (tenant_id, phone_e164)
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete restrict,
  external_id text,
  platform text not null,
  status text not null check (status in ('reserved', 'booked', 'completed', 'no_show', 'cancelled')),
  status_source text not null check (status_source in ('platform', 'inferred', 'staff', 'workflow')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  service text not null,
  value_chf numeric(10,2) not null check (value_chf >= 0),
  staff text not null,
  staff_calendar_id text not null,
  lead_source text not null check (lead_source in ('call', 'instagram', 'whatsapp', 'website', 'google')),
  recovered_from_no_show_id uuid references appointments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_positive_duration check (ends_at > starts_at),
  unique (tenant_id, external_id),
  exclude using gist (
    tenant_id with =,
    staff_calendar_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('reserved', 'booked'))
);

comment on constraint appointments_tenant_id_staff_calendar_id_tstzrange_excl on appointments
  is 'Database-level final guard against overlapping active bookings on one staff calendar.';

create table booking_slot_locks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  staff_calendar_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  request_id text not null,
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  created_at timestamptz not null default now(),
  constraint booking_slot_locks_positive_duration check (ends_at > starts_at),
  unique (tenant_id, request_id),
  exclude using gist (
    tenant_id with =,
    staff_calendar_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
);

-- The credential-free calendar adapter persists its events separately from the
-- canonical appointment rows. This keeps the calendar boundary real and makes
-- it possible to detect/repair persistence drift just as with Google Calendar.
create table local_calendar_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  external_id text not null,
  calendar_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  summary text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint local_calendar_events_positive_duration check (ends_at > starts_at),
  unique (tenant_id, external_id),
  exclude using gist (
    tenant_id with =,
    calendar_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
);

create or replace function try_acquire_booking_slot(
  p_tenant_id uuid,
  p_staff_calendar_id text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_request_id text
)
returns table (locked boolean, lock_id uuid)
language plpgsql
as $$
declare
  new_lock_id uuid;
begin
  delete from booking_slot_locks where expires_at < now();

  if exists (
    select 1
    from appointments
    where tenant_id = p_tenant_id
      and staff_calendar_id = p_staff_calendar_id
      and status in ('reserved', 'booked')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    return query select false, null::uuid;
    return;
  end if;

  new_lock_id := gen_random_uuid();
  insert into booking_slot_locks (
    id, tenant_id, staff_calendar_id, starts_at, ends_at, request_id
  ) values (
    new_lock_id, p_tenant_id, p_staff_calendar_id, p_starts_at, p_ends_at, p_request_id
  );

  return query select true, new_lock_id;
exception
  when exclusion_violation or unique_violation then
    return query select false, null::uuid;
end;
$$;

create table messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,
  channel text not null check (channel in ('whatsapp', 'sms', 'email', 'instagram')),
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  template_id text,
  ghl_message_id text,
  delivery_status text not null check (delivery_status in ('queued', 'sent', 'delivered', 'failed', 'dropped_quiet_hours', 'stubbed')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table sequence_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete cascade,
  sequence_type text not null check (sequence_type in ('appointment_reminder', 'no_show_recovery', 'lead_follow_up', 're_engagement', 'review_request')),
  status text not null check (status in ('active', 'completed', 'exited', 'paused')),
  current_step text not null,
  next_fire_at timestamptz,
  exit_reason text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  retell_call_id text not null,
  started_at timestamptz not null,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  answered boolean not null,
  outcome text not null check (outcome in ('booked', 'inquiry', 'transferred', 'missed', 'cancelled', 'rescheduled')),
  transcript text,
  recording_url text,
  disclosure_played boolean not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, retell_call_id)
);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  requested_at timestamptz not null,
  rating smallint check (rating between 1 and 5),
  routed_to text check (routed_to in ('google', 'private')),
  received_at timestamptz,
  gbp_review_id text,
  private_feedback text,
  created_at timestamptz not null default now(),
  unique (tenant_id, appointment_id)
);

create table complaints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  source_channel text not null check (source_channel in ('phone', 'whatsapp', 'instagram', 'email', 'review')),
  detected_category text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'urgent')),
  body text,
  notified_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id uuid,
  event_type text not null,
  source text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table kpi_daily (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kpi_date date not null,
  bookings_count integer not null default 0 check (bookings_count >= 0),
  calls_answered integer not null default 0 check (calls_answered >= 0),
  calls_missed integer not null default 0 check (calls_missed >= 0),
  appointments_due integer not null default 0 check (appointments_due >= 0),
  no_shows integer not null default 0 check (no_shows between 0 and appointments_due),
  no_show_recoveries integer not null default 0 check (no_show_recoveries >= 0),
  leads_call integer not null default 0,
  leads_instagram integer not null default 0,
  leads_whatsapp integer not null default 0,
  leads_website integer not null default 0,
  leads_google integer not null default 0,
  bookings_call integer not null default 0,
  bookings_instagram integer not null default 0,
  bookings_whatsapp integer not null default 0,
  bookings_website integer not null default 0,
  bookings_google integer not null default 0,
  recovered_appointments integer not null default 0,
  recovered_revenue_estimate_chf numeric(12,2) not null default 0,
  reviews_requested integer not null default 0,
  reviews_received integer not null default 0,
  rating_sum numeric(12,2) not null default 0,
  rating_count integer not null default 0,
  average_rating numeric(3,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, kpi_date),
  constraint reviews_received_not_over_requested check (reviews_received <= reviews_requested),
  constraint rating_count_matches_reviews check (rating_count = reviews_received)
);

create index contacts_tenant_created_idx on contacts (tenant_id, created_at);
create index appointments_tenant_start_idx on appointments (tenant_id, starts_at);
create index appointments_tenant_status_idx on appointments (tenant_id, status);
create index messages_tenant_created_idx on messages (tenant_id, created_at);
create index sequence_runs_due_idx on sequence_runs (tenant_id, status, next_fire_at);
create index calls_tenant_started_idx on calls (tenant_id, started_at);
create index reviews_tenant_requested_idx on reviews (tenant_id, requested_at);
create index events_tenant_occurred_idx on events (tenant_id, occurred_at);
create index kpi_daily_tenant_date_idx on kpi_daily (tenant_id, kpi_date);
create index booking_slot_locks_expiry_idx on booking_slot_locks (expires_at);
create index local_calendar_events_calendar_time_idx on local_calendar_events (tenant_id, calendar_id, starts_at);

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tenants_touch_updated_at before update on tenants for each row execute function touch_updated_at();
create trigger contacts_touch_updated_at before update on contacts for each row execute function touch_updated_at();
create trigger appointments_touch_updated_at before update on appointments for each row execute function touch_updated_at();
create trigger local_calendar_events_touch_updated_at before update on local_calendar_events for each row execute function touch_updated_at();
create trigger sequence_runs_touch_updated_at before update on sequence_runs for each row execute function touch_updated_at();
create trigger kpi_daily_touch_updated_at before update on kpi_daily for each row execute function touch_updated_at();

create or replace function prevent_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'events is append-only';
end;
$$;

create trigger events_append_only
before update or delete on events
for each row execute function prevent_event_mutation();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tenants', 'contacts', 'appointments', 'booking_slot_locks', 'local_calendar_events', 'messages',
    'sequence_runs', 'calls', 'reviews', 'complaints', 'events', 'kpi_daily'
  ]
  loop
    execute format('alter table %I enable row level security', table_name);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_current_tenant_id()) with check (tenant_id = app_current_tenant_id())',
      table_name
    );
  end loop;
end;
$$;

commit;
