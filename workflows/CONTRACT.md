# Retell webhook contract

All endpoints accept `POST` JSON and return JSON. Paths are relative to `N8N_BASE_URL/webhook/`. The executable implementation is in `api/`; the checked-in n8n workflows remain an alternative deployment of the same request/response contract.

The API uses the canonical PostgreSQL schema through PGlite. `CALENDAR_PROVIDER=local` (the default) stores calendar events in `local_calendar_events`; `CALENDAR_PROVIDER=google` calls the real Google Calendar REST API and requires `GOOGLE_CALENDAR_ACCESS_TOKEN`. Selecting Google without that credential is a startup error and never falls back to local.

Tenant routing is deployment-owned, not caller-owned. Each workflow resolves the tenant in this order: `body.tenantId`, legacy `body.tenant_id`, webhook query `tenantId`, then n8n's `TENANT_ID` environment variable. The checked-in Retell tool schemas do not ask the caller or the language model for a tenant UUID, so a dedicated agent deployment must set `TENANT_ID` (the demo value from `config/tenant.demo.json` is `11111111-1111-4111-8111-111111111111`).

`config/tenant.demo.json` remains read-only. Provisioning writes its `booking`, `services`, `review`, and `messaging` sections to the tenant row (`adapter_config`, `services`, `review_config`, and `messaging_config`). Runtime workflows load that tenant row. In particular, `staffId` is matched against `adapter_config.staff[].id` (also accepting the configured name or aliases) and the selected entry's `calendarId` is used for Google Calendar operations. The demo mappings are `lea` → `lea.atelier-nova@calendar.demo`, `mara` → `mara.atelier-nova@calendar.demo`, and `noemi` → `noemi.atelier-nova@calendar.demo`.

## Endpoint index

| Path | Retell custom tool | Workflow |
|---|---|---|
| `check-availability` | `check_availability` | `retell-tools.json` |
| `book-appointment` | `book_appointment` | `booking-google-calendar.json` |
| `find-appointment` | `find_appointment` | `retell-tools.json` |
| `cancel-appointment` | `cancel_appointment` | `booking-google-calendar.json` |
| `reschedule-appointment` | `reschedule_appointment` | `booking-google-calendar.json` |
| `log-call` | `call_summary` | `call-logging.json` |
| `log-complaint` | `log_complaint` | `retell-tools.json` |
| `log-callback` | `log_callback_request` | `retell-tools.json` |

`review-rating` in `review-reputation.json` is deliberately not part of the Retell contract. It receives a customer's rating from the messaging/review flow, so `validate-contract.mjs` names it as the one excluded non-Retell webhook.

## `check-availability`

Request:

```json
{
  "startTime": "2026-08-25T14:00:00+02:00",
  "serviceId": "cut-and-finish",
  "staffId": "mara"
}
```

`staffId` is optional. When absent, every configured stylist is considered and the first free candidate is returned. `serviceId` accepts a configured service `id`, name, or normalized name slug; duration always comes from that service's `durationMinutes` (falling back only to the tenant's configured `defaultDurationMinutes`). The workflow submits all candidate calendar IDs to Google Calendar's FreeBusy API, applies salon hours, closure dates, Swiss holidays, service duration, and configured slot interval, and then computes alternatives.

Available response:

```json
{
  "available": true,
  "startTime": "2026-08-25T12:00:00.000Z",
  "endTime": "2026-08-25T13:00:00.000Z",
  "staffId": "mara",
  "staffName": "Mara",
  "serviceId": "cut-and-finish",
  "service": "Cut & Finish",
  "message": "Yes, Mara is available on Tuesday, 25 August at 14:00 for Cut & Finish."
}
```

Unavailable response:

```json
{
  "available": false,
  "serviceId": "cut-and-finish",
  "service": "Cut & Finish",
  "alternatives": [
    {
      "startTime": "2026-08-25T12:30:00.000Z",
      "endTime": "2026-08-25T13:30:00.000Z",
      "staffId": "mara",
      "staffName": "Mara",
      "spokenTime": "Tuesday, 25 August at 14:30"
    }
  ],
  "message": "That time is not available. The closest options are Tuesday, 25 August at 14:30 with Mara."
}
```

The response's `message` is intentionally ready for the voice agent to speak verbatim. At most three alternatives are returned.

## `book-appointment`

Request:

```json
{
  "startTime": "2026-08-25T14:00:00+02:00",
  "serviceId": "cut-and-finish",
  "staffId": "mara",
  "customerName": "Sophie",
  "customerPhone": "+41791234567",
  "customerEmail": "sophie@example.ch",
  "notes": "First visit"
}
```

`customerEmail`, `notes`, and `staffId` are optional in the Retell schema. If no `staffId` is provided, booking uses the first configured stylist; normal voice flow should pass back the `staffId` selected by `check-availability`. The workflow resolves service duration and `staffId` from tenant config, derives `endTime`, validates opening/closure rules, and checks the resolved stylist's calendar.

Before creating the event it acquires the existing PostgreSQL exclusion lock and then re-verifies the same Google Calendar. The lock's request key is `staffId:startTime:endTime`, while the database exclusion range is also keyed by `staff_calendar_id`; different stylists can therefore hold the same clock-time slot, but the same stylist cannot. Persistence failure deletes the new calendar event and releases the lock.

Success response:

```json
{
  "status": "booked",
  "appointmentId": "uuid",
  "startTime": "2026-08-25T12:00:00.000Z",
  "endTime": "2026-08-25T13:00:00.000Z",
  "staff": "Mara",
  "message": "Appointment successfully booked."
}
```

Failure responses use `status: "not_booked"`, a machine-readable `code` such as `invalid_request`, `unknown_service`, `unknown_staff`, `closed`, `slot_taken`, or `persistence_failed`, and a speakable `message`. A busy slot also returns `alternativeSlots` with up to three `{startTime, endTime}` objects.

## `find-appointment`

Request:

```json
{ "customerPhone": "+41791234567" }
```

Phone punctuation is ignored during matching. Only future appointments in `booked` state are returned, ordered by start time.

Response:

```json
{
  "found": true,
  "appointments": [
    {
      "appointmentId": "uuid",
      "startTime": "2026-08-25T12:00:00.000Z",
      "endTime": "2026-08-25T13:00:00.000Z",
      "service": "Cut & Finish",
      "staff": "Mara",
      "spokenSummary": "Cut & Finish with Mara on Tuesday, 25 August at 14:00"
    }
  ],
  "message": "I found Cut & Finish with Mara on Tuesday, 25 August at 14:00."
}
```

No match returns `found: false`, an empty `appointments` array, and a direct explanatory `message`.

## `cancel-appointment`

Request:

```json
{
  "appointmentId": "uuid-returned-by-find-appointment",
  "reason": "Caller requested cancellation"
}
```

The workflow verifies that the appointment belongs to the routed tenant and is future/booked, deletes the event from its persisted `staff_calendar_id`, marks the canonical appointment cancelled, and appends `appointment.cancelled` to the event log.

Success response:

```json
{ "status": "cancelled", "message": "Your appointment has been cancelled." }
```

An invalid or stale ID returns `status: "not_found"` and does not touch Google Calendar.

## `reschedule-appointment`

Request:

```json
{
  "appointmentId": "uuid-returned-by-find-appointment",
  "newStartTime": "2026-08-27T16:30:00+02:00"
}
```

The existing appointment supplies its duration and `staff_calendar_id`. The workflow validates the new interval, acquires a staff-and-slot-scoped lock, re-verifies that same Google Calendar, updates the event, persists the canonical time, appends `appointment.rescheduled`, and releases the lock.

Success response:

```json
{
  "status": "rescheduled",
  "startTime": "2026-08-27T14:30:00.000Z",
  "endTime": "2026-08-27T15:30:00.000Z",
  "message": "Appointment successfully rescheduled."
}
```

Failures use `status: "not_found"` or `status: "not_rescheduled"` with `code: "closed"` or `code: "slot_unavailable"`.

## `log-call`

Request sent by the `call_summary` tool:

```json
{
  "customerName": "Sophie",
  "customerPhone": "+41791234567",
  "summary": "Booked a cut with Mara.",
  "outcome": "booked"
}
```

Optional Retell transport metadata accepted by the workflow is `callId`, `startedAt`, `durationSeconds`, `answered`, `recordingUrl`, and `disclosurePlayed`. Tool outcomes are normalized to the database enum. Missing `callId`/`startedAt` get the n8n execution ID/current time; missing `disclosurePlayed: true` deliberately produces the compliance tripwire rather than silently claiming disclosure.

Response:

```json
{
  "logged": true,
  "callId": "uuid",
  "complianceFlag": null
}
```

`complianceFlag` is `recording_disclosure_missing` when disclosure was not positively logged.

## `log-complaint`

Request:

```json
{
  "customerPhone": "+41791234567",
  "customerName": "Sophie",
  "summary": "The caller is unhappy with the colour result.",
  "severity": "high"
}
```

The complaint row and `complaint.created` audit event are committed before alerting. The owner destination comes only from `review_config.ownerAlertEmail`. Live mode posts an email alert to the configured messaging transport; stub mode records a loud `stubbed` outbound owner-alert message. No branch sends to `customerPhone`, and no automated customer reply is generated.

Response:

```json
{
  "logged": true,
  "complaintId": "uuid",
  "ownerAlert": "sent",
  "automatedCustomerReply": false,
  "message": "The complaint has been logged and the owner has been alerted."
}
```

With demo stub transport, `ownerAlert` is `stubbed` and `complaints.notified_at` remains null so the system does not falsely claim delivery.
If live transport is selected but delivery fails or its configured environment variables are absent, `ownerAlert` is `failed`; the complaint remains committed and `automatedCustomerReply` remains `false`.

## `log-callback`

Request:

```json
{
  "customerPhone": "+41791234567",
  "customerName": "Sophie",
  "reason": "Wants to discuss colour correction"
}
```

Because the current schema has no separate callback table, the workflow writes the callback request to the canonical append-only `events` table as `aggregate_type = callback_request` and `event_type = callback.requested`, linked to the upserted contact. This is a real persisted callback record, not a logging stub.

Response:

```json
{
  "logged": true,
  "callbackRequestId": "events.id",
  "message": "The callback request has been recorded for the salon team."
}
```

## Deployment placeholders and non-live integrations

For the executable API:

- Local calendar mode is live and credential-free. It is the default.
- Google Calendar mode uses the real FreeBusy and Events endpoints. It needs `GOOGLE_CALENDAR_ACCESS_TOKEN`, and the demo `.demo` staff calendar IDs must be replaced in the tenant row.
- The API schedules reminder records and quiet-hours decisions in PostgreSQL. Actual reminder delivery remains owned by the messaging workflow/transport.
- Demo messaging mode is `stub`, so complaint owner alerts are persisted as explicit `stubbed` messages rather than falsely marked sent.

For n8n imports:

- PostgreSQL nodes contain `REPLACE_WITH_POSTGRES_CREDENTIAL_ID`; importers must select the deployment's database credential.
- Google Calendar nodes and the FreeBusy request contain `REPLACE_WITH_GOOGLE_CALENDAR_CREDENTIAL_ID`; live availability, booking, cancellation, and rescheduling cannot be executed until OAuth access is connected for every configured staff calendar.
- `config/tenant.demo.json` intentionally contains `.demo` calendar IDs. Replace these through per-tenant configuration/provisioning, not by editing workflow code.
- Demo `messaging.mode` is `stub`. The complaint is still persisted, but a real owner alert requires `messaging.mode = live` plus `MESSAGING_TRANSPORT_URL` and `MESSAGING_TRANSPORT_TOKEN`.
