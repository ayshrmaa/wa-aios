# API configuration

This service starts locally with an embedded PGlite database and a `NullTransport`. In that default, the worker logs each delivery it would make and records `stubbed`; it never calls an email, SMS, or WhatsApp provider.

## Service setup

### Retell

Retell supplies the voice agent that calls the API webhooks. Create an API key and agent in the [Retell dashboard](https://dashboard.retellai.com/), then configure the Retell webhook to send the same random value in the `x-retell-webhook-secret` header as `RETELL_WEBHOOK_SECRET`.

The API does not use a Retell API key. `website-template` uses `RETELL_API_KEY` and `RETELL_AGENT_ID` to create browser demo calls. Keep those values server-side in the website deployment.

Verify it by sending an authenticated request to one of the `/webhook/*` endpoints. A missing or mismatched shared secret must return HTTP 401. The supplied `npm run demo-call` also sends the header when `RETELL_WEBHOOK_SECRET` is set.

### Google Calendar

Purpose: bookings land in the salon's real calendars (one per stylist). Without it the API
uses an embedded calendar table that only exists on the machine running it.

Set `CALENDAR_PROVIDER=google` plus ONE credential mode. The API picks the mode from which
variables are present and refuses to start if none are — it never falls back to local silently.

**Mode A — OAuth refresh token (recommended for a salon's own Google account)**

1. console.cloud.google.com → New project → APIs & Services → Enable *Google Calendar API*.
2. APIs & Services → OAuth consent screen → External → add the salon owner's Google address as a test user.
3. Credentials → Create credentials → OAuth client ID → *Web application* →
   Authorised redirect URI: `http://localhost:8765/callback` → copy the client ID and secret.
4. Put `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in `.env`.
5. Run `npm run google:consent` from the repo root. It prints a URL — open it **as the Google
   account that owns the stylist calendars**, approve, and the script prints the
   `GOOGLE_OAUTH_REFRESH_TOKEN` line to add to `.env`.
6. In Google Calendar, create one calendar per stylist and put each calendar's ID
   (Settings → Integrate calendar → Calendar ID) into `config/tenant.demo.json` under
   `booking.staff[].calendarId`.

Refresh tokens do not expire unless revoked. Access tokens are minted and cached automatically
and refreshed a minute before expiry; a 401 from Google triggers exactly one refresh-and-retry.

**Mode B — Service account (for a Google Workspace domain)**

1. IAM & Admin → Service accounts → Create → Keys → Add key → JSON. Download it.
2. `GOOGLE_SERVICE_ACCOUNT_JSON=/absolute/path/to/key.json` (or paste the JSON inline).
3. Either share each stylist calendar with the service-account email (Make changes to events),
   or enable domain-wide delegation and set `GOOGLE_IMPERSONATE_EMAIL=owner@salon.ch`.

**Mode C — raw access token (development only)**

`GOOGLE_CALENDAR_ACCESS_TOKEN=ya29...` from the OAuth Playground. Expires in about an hour.
The API logs a warning at boot. Never use this in production.

Verify: `npm run doctor` prints `PASS Google calendar auth (<mode>) — token minted`.

### Resend email

Create an API key at [Resend](https://resend.com/api-keys), verify the sending domain in Resend, and set `RESEND_API_KEY` and `MAIL_FROM`. `MAIL_FROM` can be a verified email address or a complete RFC 5322 sender such as `Atelier Nova <appointments@example.com>`.

Select Resend for email in the tenant's `messaging_config`:

```json
{
  "mode": "live",
  "senderName": "Atelier Nova",
  "channels": { "email": { "provider": "resend" } }
}
```

The dispatcher sends Resend an idempotency key derived from the message UUID. Verify with a consented test contact and `npm run worker`; the message should become `sent` and appear in Resend's email activity. A missing Resend key or sender causes a clear retryable configuration error, never a NullTransport fallback.

### WhatsApp Cloud

Create a Meta app with the WhatsApp product in [Meta for Developers](https://developers.facebook.com/), add a WhatsApp Business Account and sending number, then create a permanent access token. Set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`, and select it only for WhatsApp:

```json
{
  "mode": "live",
  "channels": { "whatsapp": { "provider": "whatsapp_cloud" } }
}
```

The implementation sends a Meta template message, not a free-form WhatsApp message. Create and obtain approval for every template name used by the tenant (`appointment_t_48h`, `appointment_t_24h`, `appointment_t_2h`, `no_show_t_30m`, `no_show_day_1`, `no_show_day_3`, `no_show_day_7`, `review_rating_gate`, `review_request`, and `complaint_owner_alert`), with matching body variables. Until Meta approves those templates, this route is intentionally inert. A selected WhatsApp transport without either credential throws a clear error and never falls back silently.

Verify first with Meta's test recipient and an explicitly consented contact. A success response should move the message to `sent`; Meta delivery receipts are not yet ingested, so this does not mean `delivered`.

### Postgres

For production, provision PostgreSQL (for example a Supabase project) and copy its server-side connection string into `DATABASE_URL`. Run `npm run migrate` once, optionally with `MIGRATE_SEED=true` for the demo tenant. The migration requires permission to enable `btree_gist`, because booking collision protection uses exclusion constraints.

Use PGlite only for local development and tests. Verify Postgres by running `npm run migrate`, then starting the API. Startup logs `database_driver_active` with `driver: "postgres"`; if the schema or booking constraints are absent, startup fails rather than weakens collision protection.

## Tenant messaging configuration

Provider choice is separated from booking logic. The dispatcher reads `tenants.messaging_config` for per-channel providers and optional localized copy. Environment variables may also select a provider with `MESSAGE_TRANSPORT_EMAIL`, `MESSAGE_TRANSPORT_WHATSAPP`, `MESSAGE_TRANSPORT_SMS`, or `MESSAGE_TRANSPORT_INSTAGRAM`; tenant configuration takes precedence.

Default production-ready copy is supplied for `de-CH` and `en`. A tenant can override it without code changes:

```json
{
  "channels": { "email": { "provider": "resend" } },
  "templates": {
    "de-CH": {
      "appointment_t_24h": {
        "subject": "Erinnerung: Ihr Termin morgen bei {{salonName}}",
        "body": "Guten Tag {{firstName}}, Ihr Termin ist {{appointmentTime}}.",
        "whatsapp": {
          "name": "appointment_t_24h",
          "languageCode": "de_CH",
          "bodyParameters": ["firstName", "appointmentTime"]
        }
      }
    },
    "en": { }
  }
}
```

`de-CH` is selected first. If a template is absent, the tenant's `fallback_locale` (normally `en`) is used. The queued body is rendered when the sequence is created, so later template edits do not rewrite messages already waiting to send.

The worker honours contact consent: `email_consent` for email, `whatsapp_consent` for WhatsApp, and `sms_consent` for SMS. Missing consent or a missing recipient is terminal `failed` and no provider call is made. Quiet hours are tenant-configured (default 21:00-08:00 Europe/Zurich): ordinary messages defer to the end of quiet hours, while an appointment T-2h reminder is recorded as `dropped_quiet_hours`.

Completed appointments queue a rating prompt after `review_config.delayHours`. Post the response to `/webhook/log-review-rating` with `appointmentId`, integer `rating` (1-5), and optional `privateFeedback`. When `gateEnabled` is true, a rating at or above `threshold` queues the public Google review link; lower ratings are routed only to `privateFeedbackUrl` and are never sent the Google link.

## Environment variables

| Variable | Required | Purpose | What breaks when missing or invalid |
| --- | --- | --- | --- |
| `CALENDAR_PROVIDER` | No | `local` (default) or `google`. | Local embedded calendar; bookings never reach Google. |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REFRESH_TOKEN` | For Google mode A | Long-lived OAuth credentials for the calendar owner's account. | Startup fails with a message naming the missing variable. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | For Google mode B | Path to, or inline contents of, the service-account key. | Startup fails. |
| `GOOGLE_IMPERSONATE_EMAIL` | No | Workspace user to act as (domain-wide delegation). | Service account acts as itself; calendars must be shared with it. |
| `GOOGLE_CALENDAR_ACCESS_TOKEN` | Dev only | Raw access token. Expires hourly. | — |
| `API_BASE_URL` | For Retell scripts | Public URL Retell reaches the API on. | `retell:provision` / `retell:sync` / `doctor` refuse to run or point at localhost. |
| `RETELL_LLM_ID` / `RETELL_AGENT_ID` | No | Override the ids in `retell/.retell-ids.json`. | The ids file is used. |
| `DATABASE_URL` | No locally; yes for Postgres | PostgreSQL connection string. | Local PGlite is used when absent; production data is not used. |
| `DATABASE_SSL` | No | TLS mode: `require` default, `disable`, `verify-ca`, or `verify-full`. | Wrong TLS settings prevent Postgres connection. |
| `PGSSLMODE` | No | PostgreSQL-compatible TLS mode fallback. | Same as `DATABASE_SSL` when it is unset. |
| `DATABASE_SSL_CA` | Required only with verify TLS | PEM CA certificate. | `verify-ca` and `verify-full` fail at startup without it. |
| `DATABASE_SSL_CA_BASE64` | Alternative to CA PEM | Base64-encoded CA certificate. | Same as above if neither CA variable is present. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | No | Set `true` to verify the server certificate in require mode. | Unsafe certificate validation remains off when omitted. |
| `DATABASE_POOL_MAX` | No | Maximum Postgres pool size, default 10. | Default is used. |
| `DATABASE_POOL_IDLE_MS` | No | Postgres idle connection timeout, default 30000. | Default is used. |
| `DATABASE_CONNECT_TIMEOUT_MS` | No | Postgres connection timeout, default 10000. | Default is used. |
| `DATABASE_APPLICATION_NAME` | No | Postgres application name. | Default `wa-aios-api` is used. |
| `PGLITE_DATA_DIR` | No | Local embedded database directory. | API and worker use `api/data/pglite`. |
| `MIGRATE_SEED` | No | Seed demo tenant during `npm run migrate`. | No demo seed unless `--seed` is passed. |
| `TENANT_ID` | No | Deployed tenant ID and RLS context. | Demo tenant ID is used. |
| `ALLOW_REQUEST_TENANT_ID` | No | Allows request body/query tenant override for controlled multi-tenant use. | Request overrides are ignored. |
| `CALENDAR_PROVIDER` | No | `local` default or `google`. | Local calendar is used. |
| `GOOGLE_CALENDAR_ACCESS_TOKEN` | Required for Google | OAuth bearer token for Google Calendar API. | Google adapter refuses startup, with no local fallback. |
| `GOOGLE_CALENDAR_API_BASE` | No | Google Calendar API base URL override. | Official v3 endpoint is used. |
| `RETELL_WEBHOOK_SECRET` | Required in production | Shared secret checked on every Retell webhook. | Webhooks are accepted without authentication and a startup warning is logged. |
| `RETELL_API_KEY` | Required only by `website-template` demo calls | Server-side Retell web-call API key. | Browser demo-call route returns a configuration error; API webhooks still work. |
| `RETELL_AGENT_ID` | No, website only | Retell web-call agent ID. | The website's verified default agent is used. |
| `MESSAGE_TRANSPORT_EMAIL` | No | Email provider override: `null` or `resend`. | Tenant config or NullTransport default is used. |
| `MESSAGE_TRANSPORT_WHATSAPP` | No | WhatsApp provider override: `null` or `whatsapp_cloud`. | Tenant config or NullTransport default is used. |
| `MESSAGE_TRANSPORT_SMS` | No | SMS provider override. | Only `null` is currently supported; another choice fails clearly. |
| `MESSAGE_TRANSPORT_INSTAGRAM` | No | Instagram provider override. | Only `null` is currently supported; another choice fails clearly. |
| `MESSAGING_TRANSPORT_PROVIDER` | No | Fallback provider for any channel without a specific setting. | NullTransport default is used. |
| `RESEND_API_KEY` | Required when Resend is selected | Resend bearer credential. | Each email retries, then becomes `failed`; no fallback occurs. |
| `MAIL_FROM` | Required when Resend is selected | Resend verified sender address. | Each email retries, then becomes `failed`; no fallback occurs. |
| `WHATSAPP_TOKEN` | Required when WhatsApp Cloud is selected | Meta permanent/system-user access token. | Each WhatsApp message retries, then becomes `failed`; no fallback occurs. |
| `WHATSAPP_PHONE_NUMBER_ID` | Required when WhatsApp Cloud is selected | Meta sending phone-number ID. | Each WhatsApp message retries, then becomes `failed`; no fallback occurs. |
| `WHATSAPP_GRAPH_API_VERSION` | No | Meta Graph API version, default `v20.0`. | Default is used. |
| `MESSAGE_MAX_ATTEMPTS` | No | Attempts before terminal `failed`, default 3. | Default is used. |
| `MESSAGE_RETRY_BASE_MS` | No | Initial exponential retry delay, default 60000 ms. | Default is used. |
| `MESSAGE_RETRY_MAX_MS` | No | Maximum retry delay, default 3600000 ms. | Default is used. |
| `MESSAGE_CLAIM_LEASE_MS` | No | Maximum in-flight claim duration, default 15 minutes. | Default is used. Expired claims become `failed` to avoid an ambiguous duplicate send. |
| `MESSAGE_DISPATCH_BATCH_SIZE` | No | Maximum messages per worker cycle, default 25. | Default is used. |
| `MESSAGE_DISPATCH_INTERVAL_MS` | No | API in-process worker interval, default 60000 ms. | Default is used. |
| `NO_SHOW_SWEEP_INTERVAL_MS` | No | No-show inference interval, default 30000 ms. | Default is used. |
| `HOST` | No | HTTP bind host, default `0.0.0.0`. | Default is used. |
| `PORT` | No | HTTP port, default 3000. | Default is used. |
| `API_SOCKET_PATH` | No | Unix socket instead of TCP. | TCP bind is used. |
| `TRUST_PROXY` | No | Trust `x-forwarded-for` for rate limiting. | Socket address is used. |
| `RATE_LIMIT_MAX` | No | Requests per rate window, default 120. | Default is used. |
| `RATE_LIMIT_WINDOW_MS` | No | Rate-limit window, default 60000 ms. | Default is used. |
| `HTTP_REQUEST_TIMEOUT_MS` | No | Request timeout, default 15000 ms. | Default is used. |
| `HTTP_HEADERS_TIMEOUT_MS` | No | Headers timeout, default 10000 ms. | Default is used. |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS` | No | Keep-alive timeout, default 5000 ms. | Default is used. |
| `NODE_ENV` | No | Enables HSTS when set to `production`. | HSTS is not sent. |
| `API_BASE_URL` | No, demo script only | Base URL for `npm run demo-call`. | The demo script uses `http://127.0.0.1:3000`. |

## Running delivery

Run one delivery cycle with:

```bash
npm run worker
```

The API also runs the same cycle on `MESSAGE_DISPATCH_INTERVAL_MS`. `message_dispatch_state` is an API-owned operational table created automatically at runtime because the shared `messages` schema intentionally has no retry/lock columns. It records the claim token, attempts, retry time, and terminal reason.

The claim makes sequential worker runs idempotent. If a process dies after claiming a message but before recording the provider response, the expired claim is marked `failed`, rather than replayed, to avoid an unprovable duplicate external send. Resend additionally receives a stable idempotency key. This is deliberate at-most-once behavior for ambiguous crashes; a human can inspect and requeue a terminal failure.

## Install into a new business

Ordered, from a clean clone to a live receptionist. Every step is a command in this repo;
nothing is done by hand in a web console except creating accounts and copying keys.

1. **Clone and install** — `npm run install:all` (Node 20+).
2. **Describe the salon** — copy `config/tenant.demo.json` to `config/tenant.<slug>.json` and fill
   in: name, address, `contact.transferPhone` (where complaints and "let me speak to a person" go),
   `services[]` with real durations and CHF prices, `booking.staff[]` with one `calendarId` each,
   `booking.hours`, `booking.closureDates`, `review.googleReviewUrl`. Set
   `TENANT_CONFIG_PATH=config/tenant.<slug>.json` in `.env`. Duration matters most — it decides
   how long each booking blocks.
3. **Database** — create a Supabase project in an EU region, put its connection string in
   `DATABASE_URL`, run `cd api && npm run migrate`. (Skip this to evaluate on the embedded database.)
4. **Calendar** — follow *Google Calendar* above. `CALENDAR_PROVIDER=google`.
5. **Messages** — follow *Resend email* above. WhatsApp waits for Meta verification.
6. **Deploy the API** somewhere that does not sleep, with the `.env` values as environment
   variables. Note its public URL as `API_BASE_URL`. Set a long random `RETELL_WEBHOOK_SECRET`.
7. **Voice agent** — `RETELL_API_KEY` in `.env`, then `npm run retell:dry-run` to inspect the
   payload and `npm run retell:provision` to create the agent. Re-run it after any change to the
   prompt or tenant config; it updates in place. If only the API URL changed, `npm run retell:sync`.
8. **Phone number** — in Retell, buy or import a number and assign the agent to it. Retell sells
   US/CA numbers; for a Swiss +41 number use Twilio and SIP-trunk it into Retell.
9. **Check everything** — `npm run doctor -- --build`. Every line must be PASS or an accepted WARN.
10. **Dashboard and website** — deploy `dashboard/` and `website-template/` to Vercel from the
    repo root with the root directory set to each folder. Website env: `RETELL_API_KEY`,
    `RETELL_AGENT_ID` (the browser "talk to our receptionist" button mints web-call tokens
    server-side; the key never reaches the browser).

Local end-to-end without deploying: `npm run dev:up` boots the API, opens a temporary public
tunnel, and re-points the agent at it. The tunnel URL changes every start; the script handles
that so the agent never silently points at a dead URL.

