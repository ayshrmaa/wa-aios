-- One-off patch: point the existing Atelier Nova tenant at a single shared
-- Google Calendar. The tenant row was seeded before booking.sharedCalendarId
-- existed, so `npm run migrate` (idempotent, skips existing tenants) will not
-- add it. Run this once against the deployed database, e.g. from the Render
-- dashboard: wa-aios-db -> Connect -> PSQL Command.
--
-- Safe to run more than once.

select set_config('app.current_tenant_id', '11111111-1111-4111-8111-111111111111', false);

update tenants
set adapter_config = jsonb_set(adapter_config, '{sharedCalendarId}', '"primary"'::jsonb),
    updated_at = now()
where id = '11111111-1111-4111-8111-111111111111'::uuid;

-- Verify:
select id, adapter_config -> 'sharedCalendarId' as shared_calendar_id
from tenants
where id = '11111111-1111-4111-8111-111111111111'::uuid;
