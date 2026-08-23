# Build Notes

## Metric definitions

These definitions are contractual. Change the dashboard UI and `kpi_daily` rollup together if a future requirement changes them.

### Conversion by source

Conversion is a contact-cohort metric.

- `leads_<source>` for KPI date D counts contacts created on D in the tenant timezone with that source.
- `bookings_<source>` for KPI date D counts those same contacts who later created at least one ordinary appointment. The appointment must have `created_at >= contacts.created_at`.
- A contact counts once even when they book several appointments.
- Appointments linked through `recovered_from_no_show_id` do not qualify a lead by themselves.
- The dashboard sums cohort leads and booked contacts across the active month, then calculates `bookings / leads`.
- The raw lead-volume chart still uses `leads_<source>` without changing its definition.

This construction keeps every source conversion at or below 100 percent.

### Booking month comparison

The booking tile compares equal calendar-day windows.

- N is the latest KPI date's day of month, capped to the number of days available in the previous month.
- Current value: bookings during the first N calendar days of the current month.
- Comparison value: bookings during the first N calendar days of the previous month.
- The UI labels the basis as `Erste N Tage vs. erste N Tage Vormonat` and labels the tile `Monat bis heute`.

The current seed ends on 2026-08-23, so it compares the first 23 days of August with the first 23 days of July. Both periods contain 82 bookings, which presents a flat operating story instead of a partial-month collapse.

### Recovered no-show

One recovered no-show is one distinct no-show appointment with at least one linked replacement appointment through `recovered_from_no_show_id`. The replacement must have status `booked` or `completed`.

- The recovery is attributed to the original no-show date.
- `no_show_recoveries` and `recovered_appointments` receive the same distinct count.
- `recovered_revenue_estimate_chf = recovered_appointments * tenants.avg_appointment_value_chf` on every KPI row.
- The recovery-rate tile and estimated-revenue tile therefore tell one story from the same recovered count.

## Enforced database assertions

[`db/validate.mjs`](db/validate.mjs) fails when any of these conditions occurs:

- A source has more booked cohort contacts than cohort leads.
- Recovered revenue differs from recovered count multiplied by the tenant's average appointment value.
- No-shows exceed appointments due.

The existing cross-table checks also compare appointment, recovery, and review records with their KPI totals.

## Seed data

[`db/generate-seed.mjs`](db/generate-seed.mjs) creates leads before their selected appointments, assigns appointment booking timestamps after contact creation, and generates the 70-day KPI rollup. The visible current-month demo rates are non-perfect: call answer rate is 89.5 percent, recovery rate is 20 percent, and source conversions range from 38.5 to 92.3 percent.

Regenerate both committed artifacts after changing the generator or tenant config:

```bash
cd db
npm run seed:generate
npm run export:dashboard
npm run validate
```

## Dashboard: real and stubbed

Real:

- The Next.js dashboard, metric calculations, Postgres reader, snapshot fallback, schema, generated seed, and invariant validator run locally.
- With `DATABASE_URL`, the dashboard reads `tenants` and `kpi_daily` from Postgres.

Stubbed or demo-only:

- Without `DATABASE_URL`, the dashboard displays the committed seed snapshot.
- The seed uses generated contacts, calls, appointments, recoveries, and reviews.
- Live booking platforms, Retell, GHL, ManyChat, and n8n must populate the canonical tables before the dashboard represents a real salon.

Live requirements:

- `DATABASE_URL`
- `DATABASE_SSL=true` when the provider requires SSL
- `NEXT_PUBLIC_DEMO_TENANT_ID` for the tenant to display
- Supabase or Postgres credentials for migrations and ingestion jobs
- Provider credentials documented by each workflow and adapter, including GHL, Retell, booking platform, and messaging access

## Audit generator: real and stubbed

Real:

- [`audit-generator/generate.mjs`](audit-generator/generate.mjs) validates JSON, performs the printed calculations, and writes a real six-page PDF.
- [`audit-generator/verify.mjs`](audit-generator/verify.mjs) checks the PDF header, EOF marker, file size, page count, required section names, and case-study omission.
- The page order is cover, executive summary, revenue leak breakdown, solution mapping, what we'll build, and investment and next steps.

Stubbed or intentionally omitted:

- Discovery values are entered manually. The generator does not pull CRM or telephony data.
- `rebookingGapRate` is an explicit input because the SPEC revenue formula requires it. `ratingScaleMax` supplies the displayed rating denominator. The generator does not invent either value.
- The investment page does not print a price because pricing is absent from the discovery input.
- The case-study page is absent until a verified client result exists.

Live requirements:

- No credentials are required for local PDF generation.
- A live intake flow would need an authenticated source for discovery JSON.
- Add approved pricing to the input contract before printing investment figures.
- Add a case-study page only after a client has approved a traceable result and its publication.

## Website template: real and stubbed

Real:

- The one-page Next.js site builds as static content.
- Hero, missed-call section, asymmetric five-item feature grid, and final CTA are implemented.
- Colors, fonts, salon identity, phone, contact details, CTA labels, CTA URLs, statistics, and page copy come from [`config/tenant.demo.json`](config/tenant.demo.json).
- The project includes a generated, config-neutral salon hero image at [`website-template/public/salon-hero.png`](website-template/public/salon-hero.png).

Stubbed or demo-only:

- `links.booking`, `links.consultation`, and review URLs still use `example.com` placeholders.
- The demo phone value and `tel:` destination require a live Retell or carrier route before launch.
- The missed-call value is demo configuration, not a live telephony feed.
- The site has no form backend, analytics, consent manager, or production deployment configuration.

Live requirements:

- Real salon identity, phone, address, email, booking URL, consultation URL, and approved copy in the tenant config
- A live Retell phone number or equivalent routing target for `links.demoAgent`
- Booking-platform credentials only if the CTA moves from a link to API-backed booking
- Hosting project access and production domain/DNS configuration
- Analytics and consent credentials if the client elects to add those services
