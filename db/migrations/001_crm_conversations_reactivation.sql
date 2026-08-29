-- 001 — CRM 360, AI conversations, richer call ingestion, lead reactivation.
-- Additive only. Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- CONTACTS: lifecycle + interaction rollups so a contact IS the CRM record.
-- ---------------------------------------------------------------------------
alter table contacts add column if not exists lifecycle_stage text not null default 'lead';
do $$ begin
  alter table contacts add constraint contacts_lifecycle_stage_check
    check (lifecycle_stage in ('lead', 'active', 'inactive', 'vip'));
exception when duplicate_object then null; end $$;

alter table contacts add column if not exists last_interaction_at timestamptz;
alter table contacts add column if not exists last_interaction_kind text;
alter table contacts add column if not exists first_booked_at timestamptz;
alter table contacts add column if not exists last_booked_at timestamptz;
alter table contacts add column if not exists total_bookings integer not null default 0;
alter table contacts add column if not exists completed_bookings integer not null default 0;
alter table contacts add column if not exists no_show_count integer not null default 0;
alter table contacts add column if not exists lifetime_value_chf numeric(12,2) not null default 0;
alter table contacts add column if not exists tags text[] not null default '{}';
alter table contacts add column if not exists marketing_opt_out boolean not null default false;
alter table contacts add column if not exists preferred_staff text;

create index if not exists contacts_tenant_lifecycle_idx on contacts (tenant_id, lifecycle_stage, last_interaction_at desc nulls last);
create index if not exists contacts_tenant_last_booked_idx on contacts (tenant_id, last_booked_at desc nulls last);

-- ---------------------------------------------------------------------------
-- CONTACT NOTES: a staff/AI/system timeline entry.
-- ---------------------------------------------------------------------------
create table if not exists contact_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  author text not null default 'staff' check (author in ('staff', 'ai', 'system')),
  kind text not null default 'note' check (kind in ('note', 'call', 'message', 'appointment', 'lead', 'reactivation', 'status')),
  body text not null,
  pinned boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists contact_notes_contact_idx on contact_notes (tenant_id, contact_id, created_at desc);

-- ---------------------------------------------------------------------------
-- CONVERSATIONS: one open thread per contact+channel, with AI handling state.
-- ---------------------------------------------------------------------------
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'sms', 'email', 'instagram')),
  status text not null default 'open' check (status in ('open', 'ai_handling', 'human_needed', 'closed')),
  ai_enabled boolean not null default true,
  subject text,
  last_message_at timestamptz,
  last_direction text check (last_direction in ('inbound', 'outbound')),
  last_inbound_at timestamptz,
  unread_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, contact_id, channel)
);
create index if not exists conversations_tenant_status_idx on conversations (tenant_id, status, last_message_at desc nulls last);

create trigger conversations_touch_updated_at before update on conversations
  for each row execute function touch_updated_at();

-- MESSAGES: thread + AI provenance + inbound classification.
alter table messages add column if not exists conversation_id uuid references conversations(id) on delete set null;
alter table messages add column if not exists direction_verified boolean not null default true;
alter table messages add column if not exists ai_generated boolean not null default false;
alter table messages add column if not exists inbound_intent text;
alter table messages add column if not exists campaign_id uuid;
alter table messages add column if not exists in_reply_to uuid references messages(id) on delete set null;
create index if not exists messages_conversation_idx on messages (tenant_id, conversation_id, created_at);

-- Allow inbound messages that were received (not queued for send).
do $$ begin
  alter table messages drop constraint if exists messages_delivery_status_check;
  alter table messages add constraint messages_delivery_status_check
    check (delivery_status in ('queued', 'sent', 'delivered', 'failed', 'dropped_quiet_hours', 'stubbed', 'received'));
exception when others then null; end $$;

-- ---------------------------------------------------------------------------
-- CALLS: full post-call analysis from the Retell platform webhook.
-- ---------------------------------------------------------------------------
alter table calls add column if not exists direction text not null default 'inbound';
do $$ begin
  alter table calls add constraint calls_direction_check check (direction in ('inbound', 'outbound'));
exception when duplicate_object then null; end $$;
alter table calls add column if not exists from_number text;
alter table calls add column if not exists to_number text;
alter table calls add column if not exists ended_at timestamptz;
alter table calls add column if not exists summary text;
alter table calls add column if not exists sentiment text;
alter table calls add column if not exists user_sentiment text;
alter table calls add column if not exists call_successful boolean;
alter table calls add column if not exists in_voicemail boolean;
alter table calls add column if not exists disconnection_reason text;
alter table calls add column if not exists latency_ms integer;
alter table calls add column if not exists cost_cents integer;
alter table calls add column if not exists analysis jsonb not null default '{}'::jsonb;
alter table calls add column if not exists transcript_object jsonb;
alter table calls add column if not exists lead_id uuid references leads(id) on delete set null;
alter table calls add column if not exists appointment_id uuid references appointments(id) on delete set null;

do $$ begin
  alter table calls drop constraint if exists calls_outcome_check;
  alter table calls add constraint calls_outcome_check check (outcome in (
    'booked', 'inquiry', 'transferred', 'missed', 'cancelled', 'rescheduled',
    'complaint', 'callback', 'voicemail', 'spam', 'other'
  ));
exception when others then null; end $$;

-- ---------------------------------------------------------------------------
-- APPOINTMENTS: remember which lead / campaign produced the booking.
-- ---------------------------------------------------------------------------
alter table appointments add column if not exists lead_id uuid references leads(id) on delete set null;
alter table appointments add column if not exists reactivation_campaign_id uuid;
alter table appointments add column if not exists booked_via text;   -- 'call' | 'ai_chat' | 'dashboard' | 'reactivation'
alter table appointments add column if not exists notes text;

-- ---------------------------------------------------------------------------
-- REACTIVATION CAMPAIGNS.
-- ---------------------------------------------------------------------------
create table if not exists reactivation_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
  channel text not null default 'email' check (channel in ('whatsapp', 'sms', 'email', 'instagram')),
  criteria jsonb not null default '{}'::jsonb,
  offer text,
  goal text,
  message_style text not null default 'warm',
  daily_send_cap integer not null default 40 check (daily_send_cap between 1 and 1000),
  total_targeted integer not null default 0,
  messages_sent integer not null default 0,
  responses integer not null default 0,
  bookings integer not null default 0,
  created_by text,
  launched_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reactivation_campaigns_tenant_idx on reactivation_campaigns (tenant_id, status, created_at desc);
create trigger reactivation_campaigns_touch_updated_at before update on reactivation_campaigns
  for each row execute function touch_updated_at();

create table if not exists reactivation_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  campaign_id uuid not null references reactivation_campaigns(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'queued', 'sent', 'responded', 'booked', 'opted_out', 'failed', 'skipped')),
  channel text not null check (channel in ('whatsapp', 'sms', 'email', 'instagram')),
  personalised_body text,
  message_id uuid references messages(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  scheduled_for timestamptz,
  sent_at timestamptz,
  responded_at timestamptz,
  booked_appointment_id uuid references appointments(id) on delete set null,
  last_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);
create index if not exists reactivation_targets_due_idx on reactivation_targets (tenant_id, status, scheduled_for);
create trigger reactivation_targets_touch_updated_at before update on reactivation_targets
  for each row execute function touch_updated_at();

alter table sequence_runs drop constraint if exists sequence_runs_sequence_type_check;
alter table sequence_runs add constraint sequence_runs_sequence_type_check check (sequence_type in (
  'appointment_reminder', 'no_show_recovery', 'lead_follow_up', 're_engagement',
  'review_request', 'appointment_confirmation', 'appointment_completion', 'reactivation'
));

-- ---------------------------------------------------------------------------
-- RLS for the new tenant-scoped tables.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['contact_notes', 'conversations', 'reactivation_campaigns', 'reactivation_targets']
  loop
    execute format('alter table %I enable row level security', t);
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'tenant_isolation'
    ) then
      execute format(
        'create policy tenant_isolation on %I using (tenant_id = app_current_tenant_id()) with check (tenant_id = app_current_tenant_id())',
        t
      );
    end if;
  end loop;
end $$;

commit;
