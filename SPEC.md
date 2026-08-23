# Work Artificial — AIOS

Implementation spec. Source: Work Artificial Operational Briefing Document v2.0.
Target: Swiss beauty & hair salons. Deliverable: a multi-tenant template stack deployable per client.

Status: DRAFT — not yet approved for build.

---

## 1. Scope

Everything in the briefing document. Seven services:

| # | Service | Primary surface |
|---|---------|-----------------|
| 1 | AI Receptionist | Retell voice agent on the salon's line |
| 2 | Reporting Dashboard | Next.js app |
| 3 | AI Customer Service | Shared FAQ/complaint layer across phone, WhatsApp, IG |
| 4.1 | Lead Follow-Up Automation | n8n + GHL sequences |
| 4.2 | Appointment Reminder Automation | n8n + GHL sequences |
| 5 | WhatsApp + Instagram Automation | ManyChat flows |
| 6 | Review & Reputation System | n8n + GHL |
| 7 | Website Redeployment (upsell) | Next.js landing template |

Plus: onboarding/provisioning kit, Swiss compliance document set, audit report generator.

### Non-goals

- Rebuilding CRM functionality GHL already provides.
- Paid ads, creative production, or SEO.
- Any per-client custom code path. Customization is configuration only (Section 4). A client need that cannot be expressed as config is a product change, not a client change.

---

## 2. Architecture

### 2.1 Component boundary

GHL is the system of record for contacts, pipeline stages, and outbound messaging. The custom stack does only what GHL cannot.

| Concern | Owner | Why |
|---|---|---|
| Contacts, pipelines, opportunity stages | GHL | Already the standard; owner-facing UI exists |
| Outbound WhatsApp / SMS / email send | GHL | Handles provider compliance, opt-outs, delivery receipts |
| Booking platform integration | Custom (adapters) | GHL has no Fresha/Booksy/Square-Appointments path |
| Canonical appointment state | Custom (Postgres) | Needs cross-platform normalization |
| No-show detection and recovery math | Custom | Requires appointment state GHL never sees |
| KPI rollups and ROI attribution | Custom | GHL reporting cannot express recovered-revenue |
| Dashboard | Custom (Next.js) | Owner-facing, branded, per the doc's metric list |
| Voice agent tool-calls | n8n webhooks | Retell custom tools POST to n8n; this already works |

### 2.2 Stack

- **Postgres (Supabase)** — canonical store, row-level security per tenant.
- **n8n** — all workflow orchestration. Matches the existing `pe-linkedin-outreach-engine` pattern.
- **Next.js on Vercel** — dashboard and the website-redeployment template.
- **Retell** — voice. Standardized across all clients. Existing working agents (`[UNIVERSAL]`, `Anthonys Salon`) are the baseline. Model `gpt-5.1`, ElevenLabs voices.
- **GHL** — CRM and messaging transport.
- **ManyChat** — Instagram/WhatsApp DM flows.

### 2.3 Multi-tenancy

One deployment serves all salons. Every table carries `tenant_id`. Every n8n workflow receives `tenant_id` on its trigger payload and loads tenant config as its first step. No workflow may contain a hardcoded client value.

---

## 3. The booking adapter

The spine of the system. Downstream services never learn which booking platform a salon uses.

### 3.1 Capability tiers

| Tier | Platforms | Read | Write | Reschedule |
|---|---|---|---|---|
| **Full** | Square Appointments, Cal.com, Acuity, Vagaro | API + webhooks | yes | yes |
| **Read-only** | Fresha (Snowflake Data Connector), Booksy (iCal/calendar sync) | poll | no | link out to native UI |
| **Native** | Salon has no system | self-hosted Cal.com | yes | yes |

Verified constraints:
- Fresha publishes no public API. Its Data Connector (Reports → Data Connector) issues Snowflake credentials and is the only supported data path. Read-only.
- Booksy's public API docs return 401; OAuth2 app registration is contact-us only. No self-serve path.

Onboarding assigns a tier. Tier determines which features a salon gets, and the audit report must not promise write-tier capability to a read-tier salon.

### 3.2 Interface

Every adapter implements:

```
listAppointments(since: timestamp) -> Appointment[]
getAppointment(externalId) -> Appointment
capabilities() -> { canWrite, canReschedule, canCancel, hasWebhooks }
createAppointment(draft) -> Appointment        // Full/Native only
rescheduleAppointment(externalId, newStart)     // Full/Native only
cancelAppointment(externalId)                   // Full/Native only
```

Adapters normalize to the canonical `appointments` row and emit events: `appointment.created`, `appointment.updated`, `appointment.completed`, `appointment.no_show`.

Full-tier adapters emit on webhook. Read-only tiers emit from a 15-minute poll differ. Downstream consumers cannot tell the difference.

### 3.3 No-show detection

Full tier: platform reports the status directly.
Read-only tier: an appointment whose `starts_at` is more than 30 minutes past, still in `booked` state, and not marked completed on the next poll is inferred `no_show`. Inference is recorded as `status_source = 'inferred'` so the dashboard can distinguish it and the recovery sequence can use a softer opening line.

---

## 4. Data model

All tables carry `tenant_id uuid not null` and RLS.

- **tenants** — salon identity, locale (`de-CH` | `fr-CH` | `it-CH` | `en`), timezone, branding (logo, colours, fonts), `avg_appointment_value_chf`, `baseline_no_show_rate`, booking tier + adapter config, quiet hours, GHL location id, Retell agent id.
- **contacts** — mirrors GHL contact, keyed by `ghl_contact_id`. Consent flags per channel, source attribution.
- **appointments** — canonical. `external_id`, `platform`, `status`, `status_source`, `starts_at`, `service`, `value_chf`, `staff`, `contact_id`.
- **messages** — every inbound/outbound message. Channel, direction, body, template id, GHL message id, delivery status.
- **sequence_runs** — which ladder a contact is on, current step, `next_fire_at`, exit reason.
- **calls** — Retell call id, duration, outcome, transcript, recording url, `disclosure_played bool not null`.
- **reviews** — requested_at, rating, routed_to (`google` | `private`), received_at, gbp_review_id.
- **complaints** — source channel, detected category, severity, notified_at, resolved_at.
- **events** — append-only audit log. Every state change. Source of truth for the dashboard and for disputes.
- **kpi_daily** — nightly rollup per tenant. Backs the dashboard; never computed live.

---

## 5. Service specifications

### 5.1 AI Receptionist

Retell agent per tenant, configured from `tenants`. Two agent profiles per the doc: lead-detail (new inquiries) and off-time (after hours). Routing set at the number level.

- Every call opens with the recording disclosure line. Non-skippable, logged to `calls.disclosure_played`. A call that fails to log disclosure is flagged for review — this is the compliance tripwire.
- Tool-calls hit the custom API: `check_availability`, `book_appointment`, `reschedule_appointment`, `get_service_price`, `handoff_to_human`.
- On a read-only-tier tenant, `book_appointment` is not registered on the assistant. The agent collects the request and creates a GHL opportunity for the front desk instead. It must never claim a booking it cannot make.
- Handoff routes to the front desk or on-call number.
- Call outcome, transcript, and any created lead sync to GHL.

Acceptance: 100% of completed calls have `disclosure_played = true`. Zero booking confirmations issued on read-only tenants.

### 5.2 Reporting Dashboard

Next.js, per-tenant branded, reads `kpi_daily`. Metrics exactly as the doc lists:

- Bookings this month vs last, % change
- Calls answered vs missed (target 100%)
- No-show rate and recovery rate
- Lead source breakdown: calls, IG DM, WhatsApp, website, Google
- Lead-to-booking conversion per source
- Revenue recovered from no-show sequences, computed as recovered appointments × `avg_appointment_value_chf`
- Reviews requested vs received, average rating trend

Recovered-revenue is an estimate and must be labelled as one in the UI. It is the retention number; overstating it is how the account gets lost at month four.

### 5.3 AI Customer Service

One FAQ/intent layer, three surfaces (phone via Retell, WhatsApp + IG via ManyChat). Tenant FAQ and pricing loaded from config.

Complaint detection runs before any auto-reply. On detection: no automated answer is sent, the thread is flagged to `complaints`, and the owner is notified. Weekly digest to the owner: volume handled, top questions, complaints flagged.

Acceptance: a message classified as a complaint never receives an automated reply. This is a hard invariant, tested.

### 5.4 Lead Follow-Up Automation

Trigger: lead from receptionist, ManyChat, website form, or manual entry, with no booking on first contact.

Qualify (service interest, urgency, preferred time) → personalized follow-up within minutes → log to GHL pipeline with source attribution. Re-engagement ladder for leads that stay cold. Exits immediately on booking.

### 5.5 Appointment Reminder Automation

Exactly as specified in the doc:

- **T-48h** — WhatsApp confirmation with reschedule link
- **T-24h** — email reminder, appointment details and what to bring
- **T-2h** — final WhatsApp nudge

No-show recovery:

- **+30 min** — WhatsApp, same day
- **Day 1** — email
- **Day 3** — WhatsApp, optional incentive (per-tenant toggle, default off)
- **Day 7** — moves to re-engagement if unanswered

Reschedule links are deep links on Full/Native tiers; on read-only tiers they point to the salon's native booking page.

All sends respect tenant quiet hours (default: no outbound 21:00–08:00 local). A step falling in quiet hours defers to the next open window — except T-2h, which is dropped rather than sent late, since a reminder after the appointment is worse than none.

### 5.6 WhatsApp + Instagram Automation

ManyChat. Triggers: direct DM, Story reply, comment keyword (`price?`, `info`), "DM us to book" CTA.

Welcome message with service menu and quick replies → qualify (service, prior client, preferred date) → booking link or human handoff → sync to GHL → hand to Lead Follow-Up if no booking completes.

ManyChat flows are built in its UI, not deployed from code. The deliverable here is a documented, screenshot-backed reference build plus an export, not a program. Treat it as a runbook.

Blocked on: Meta Business verification, IG Business account, linked Facebook Page. Per client, days to weeks. Onboarding must start this on day one because it is the long pole.

### 5.7 Review & Reputation System

- Review request fires on appointment completion (delay per tenant, default 2h).
- Rating gate: at or above threshold (default 4) → Google review link. Below → private feedback form, never the public link.
- Complaint alert to owner on low rating, before public damage.
- Tracked: requests sent, reviews received, average rating, negative feedback count.

Note for the client, not a build blocker: gating who gets asked for a public review is against Google's review-gating policy and can cost a business its reviews. Flag it to Work Artificial in writing before launch and let them decide. The build supports a `gate_enabled` toggle; default it on only if they accept the risk explicitly.

### 5.8 Website Redeployment (upsell)

Next.js landing template for a salon: hero, services, staff, booking CTA wired to the tenant's booking tier, reviews block, contact. Tokenized branding so it takes tenant config. Sold separately, invoiced separately, per the doc.

---

## 6. Swiss compliance

Five documents, built once, reused per client. No onboarding proceeds without them.

1. AI Recording Disclosure Script — mandatory opening line on every receptionist call.
2. Data Processing Agreement — Work Artificial as processor, client as controller.
3. Privacy Policy.
4. Client Service Agreement, 6-month minimum term.
5. Security & Data Handling Policy.

These are drafted as templates by this build. **They require review by a Swiss-qualified lawyer before any client signs.** Nothing in this repo is legal advice.

Technical obligations: revDSG applies. Data resident in EU/CH regions. Consent flags enforced per channel before any send. Deletion request path must reach Postgres, GHL, Retell recordings, and ManyChat.

---

## 7. Onboarding and provisioning

A tenant goes live through a scripted provisioning run, not manual clicking. Inputs are the doc's Section 5 checklist. Provisioning creates: tenant row, GHL sub-account, Retell agent, adapter credentials, dashboard tenant, branded templates.

Onboarding gates:
- Booking tier assigned and confirmed with the client.
- Compliance documents signed.
- Meta verification started (long pole).
- Recording disclosure acknowledgment signed.

Missing any required item blocks the run. The script fails loudly rather than provisioning half a tenant.

---

## 8. Audit report generator

Branded PDF, generated from template plus per-prospect data. Page structure exactly as the doc's Section 6.1: cover, executive summary, revenue leak breakdown, solution mapping, what we'll build, case study, investment and next steps.

The revenue-leak page computes from discovery inputs: no-shows/week × `avg_appointment_value_chf` × rebooking gap. Every number traces to an input; no figure is invented.

Per the doc's own instruction, the case study page is omitted entirely until a real founding-client result exists. The generator must not emit a placeholder case study.

---

## 9. Build order

Dependency-driven, not priority-driven.

1. Data spine — Postgres schema, tenant config, event log, RLS
2. Booking adapters — Square + Cal.com first to prove the contract, then Fresha read-only, Booksy, Acuity, Vagaro, native
3. Reminder + no-show recovery
4. Review & reputation
5. Lead follow-up + AI customer service
6. Reporting dashboard
7. AI receptionist (Retell)
8. ManyChat runbook
9. Audit generator, website template, compliance drafts (parallel, no dependencies)

Meta verification and phone provisioning start at step 1 regardless, because they are wall-clock blocked, not work blocked.

## 10. Repo layout

```
wa-aios/
  SPEC.md
  README.md
  BUILD_NOTES.md
  db/                 schema, migrations, RLS policies
  adapters/           booking adapter contract + implementations
  workflows/          n8n JSON, one per sequence
  api/                Retell tool-call endpoints, webhook receivers
  dashboard/          Next.js
  website-template/   Next.js upsell template
  audit-generator/    template + PDF build
  manychat/           runbook + flow exports
  compliance/         document templates
  onboarding/         provisioning script + intake form
```

## 11. Definition of done

- A new salon goes from signed to live by running provisioning with a config file and no code changes.
- Every sequence in Section 5 fires on schedule, respects quiet hours, and exits correctly on booking.
- Read-only-tier salons get reminders, no-show recovery, reviews, and dashboard — and are never promised booking writes.
- Complaint messages never receive an automated reply.
- Every call logs its recording disclosure.
- The dashboard's recovered-revenue figure traces to real appointment records.
