-- 003 — Demo enrichment ONLY for the seeded Atelier Nova tenant: a pool of
-- lapsed past customers (last visit 3–9 months ago, no upcoming booking) so the
-- reactivation feature has a realistic audience in sales demos. Scoped hard to
-- the demo tenant UUID and skipped entirely if that tenant is absent or already
-- enriched. Never touches a real tenant.

do $$
declare
  demo_tenant constant uuid := '11111111-1111-4111-8111-111111111111';
  cal text;
  i int;
  cid uuid;
  aid uuid;
  visited timestamptz;
  svc text;
  price numeric;
  fname text;
  lname text;
  first_names text[] := array['Anna','Lena','Sofia','Elena','Nora','Chiara','Julia','Marie','Livia','Sara','Mia','Alina','Nina','Laura','Petra','Sandra','Rahel','Céline','Fiona','Gina','Tanja','Vera','Yara','Zoé','Bettina','Carla','Doris','Eva','Franca','Gabi'];
  last_names text[] := array['Meier','Keller','Baumann','Frei','Hofer','Graf','Wyss','Roth','Steiner','Brunner','Moser','Widmer','Bianchi','Rossi','Fontana','Schmid','Huber','Gerber','Kaufmann','Suter'];
  services text[] := array['Cut & Finish','Balayage','Gloss & Care','Men''s Cut'];
  prices numeric[] := array[118, 248, 138, 78];
begin
  if not exists (select 1 from tenants where id = demo_tenant) then
    raise notice 'demo tenant absent — skipping demo enrichment';
    return;
  end if;

  perform set_config('app.current_tenant_id', demo_tenant::text, true);

  if exists (select 1 from contacts where tenant_id = demo_tenant and 'demo-lapsed' = any(tags)) then
    raise notice 'demo lapsed customers already present — skipping';
    return;
  end if;

  select coalesce(adapter_config->>'sharedCalendarId', 'primary') into cal from tenants where id = demo_tenant;

  for i in 1..34 loop
    fname := first_names[1 + (i * 7) % array_length(first_names, 1)];
    lname := last_names[1 + (i * 3) % array_length(last_names, 1)];
    svc := services[1 + i % 4];
    price := prices[1 + i % 4];
    -- last visit between ~95 and ~275 days ago
    visited := now() - make_interval(days => 95 + (i * 13) % 180, hours => 9 + i % 7);
    cid := gen_random_uuid();

    insert into contacts (
      id, tenant_id, first_name, last_name, email, phone_e164, source,
      email_consent, whatsapp_consent, lifecycle_stage, tags,
      total_bookings, completed_bookings, first_booked_at, last_booked_at,
      lifetime_value_chf, last_interaction_at, last_interaction_kind
    ) values (
      cid, demo_tenant, fname, lname,
      lower(fname || '.' || lname || i || '@example.ch'),
      '+41 79 4' || lpad((100000 + i * 811)::text, 6, '0'),
      'call', true, true, 'inactive', array['demo-lapsed'],
      1 + i % 3, 1 + i % 3, visited - interval '210 days', visited,
      price * (1 + i % 3), visited, 'appointment'
    );

    -- one completed historical appointment (plus a couple more for repeat clients)
    for _ in 1..(1 + i % 3) loop
      aid := gen_random_uuid();
      insert into appointments (
        id, tenant_id, contact_id, external_id, platform, status, status_source,
        starts_at, ends_at, service, value_chf, staff, staff_calendar_id, lead_source, booked_via
      ) values (
        aid, demo_tenant, cid, 'demo-lapsed-' || aid, 'local', 'completed', 'inferred',
        visited, visited + interval '1 hour', svc, price, 'Atelier Nova', cal, 'call', 'call'
      );
      visited := visited - make_interval(days => 40 + i % 30);
    end loop;
  end loop;

  perform set_config('app.current_tenant_id', '', true);
  raise notice 'demo enrichment: added 34 lapsed customers';
end $$;
