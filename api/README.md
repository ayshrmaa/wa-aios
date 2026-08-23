# WA AIOS booking API

This is the executable Retell webhook runtime. It supports real pooled Postgres in production and credential-free PGlite for local development while keeping the same `query`, `transaction`, and `close` database interface.

## Local development

Node 20 or newer is required.

```bash
npm install
npm start
```

When `DATABASE_URL` is absent, the API uses PGlite and creates its persistent database under `api/data/pglite`. To start from a fresh local database without deleting an existing one:

```bash
PGLITE_DATA_DIR=/tmp/wa-aios-fresh PORT=3000 npm start
```

The server reads `PORT` (default `3000`) and binds to `HOST` (default `0.0.0.0`). Its health response identifies the active adapters:

```bash
curl http://127.0.0.1:3000/health
```

## Postgres and migrations

When `DATABASE_URL` is set, the API uses a `pg` connection pool and encrypted Postgres connections suitable for Supabase. Run the bootstrap before starting it:

```bash
DATABASE_URL='postgresql://...' npm run migrate
```

The migration reads the canonical `db/schema.sql` without modifying it. It is idempotent: it applies the schema only when it is absent and verifies the required `btree_gist` extension and all three exclusion constraints on every run. Add the demo seed only when wanted:

```bash
DATABASE_URL='postgresql://...' npm run migrate -- --seed
```

`MIGRATE_SEED=true npm run migrate` is equivalent. Existing demo seed data is detected and skipped.

The concurrency guarantee is fail-closed. If `CREATE EXTENSION IF NOT EXISTS btree_gist` or any required exclusion constraint is unavailable, migration and production boot fail loudly. There is no weaker locking fallback.

Database settings:

- `DATABASE_POOL_MAX` defaults to `10`.
- `DATABASE_POOL_IDLE_MS` defaults to `30000`.
- `DATABASE_CONNECT_TIMEOUT_MS` defaults to `10000`.
- `DATABASE_SSL` defaults to `require`; production should use `verify-full`. Set `false` only for a trusted local Postgres without TLS.
- `DATABASE_SSL_CA` accepts the Supabase CA certificate PEM. `DATABASE_SSL_CA_BASE64` accepts the same certificate as base64. Either is required for `verify-ca` or `verify-full`.
- `DATABASE_SSL_REJECT_UNAUTHORIZED=true` enables certificate verification with other TLS modes.

## Webhook security and HTTP operations

The Retell endpoints are:

- `POST /webhook/check-availability`
- `POST /webhook/book-appointment`
- `POST /webhook/find-appointment`
- `POST /webhook/reschedule-appointment`
- `POST /webhook/cancel-appointment`
- `POST /webhook/log-call`
- `POST /webhook/log-complaint`
- `POST /webhook/log-callback`

Set `RETELL_WEBHOOK_SECRET` and send the same value in the `x-retell-webhook-secret` header on every webhook request. If the variable is missing, the API still boots but emits a structured warning at boot and for every unauthenticated webhook it accepts.

Every request gets an `x-request-id` response header and a structured JSON completion log. `RATE_LIMIT_MAX` defaults to 120 requests per `RATE_LIMIT_WINDOW_MS` (default 60000 milliseconds) per IP. Set `TRUST_PROXY=true` behind Render so the limiter uses the originating `x-forwarded-for` address.

Client-visible failures contain a caller-safe message and request ID; internal details and stacks stay out of response bodies. `SIGINT` and `SIGTERM` stop accepting HTTP traffic, drain connections, and then close PGlite or the Postgres pool.

`TENANT_ID` selects the deployment-owned tenant and defaults to the demo tenant ID. Caller-provided tenant IDs are ignored unless `ALLOW_REQUEST_TENANT_ID=true` is deliberately enabled.

## Render deployment

Render was selected because its current free web-service flow requires no payment method. The service uses Render's native Node runtime, so a Dockerfile is unnecessary. The included `api/render.yaml` is configured for the free plan, `/health`, a generated webhook secret, proxy-aware rate limiting, and migrations on every boot.

For a monorepo deployment:

1. Create a Supabase project. Copy its Postgres Session Pooler connection string, replace the password placeholder, and download the project CA certificate from **Database Settings > SSL Configuration**.
2. Push the repository, including the sibling `api/` and `db/` directories, to GitHub, GitLab, or Bitbucket.
3. In Render, choose **New > Blueprint**, connect the repository, and set **Blueprint Path** to `api/render.yaml`.
4. Enter the Supabase connection string for `DATABASE_URL` and paste the complete CA certificate PEM into `DATABASE_SSL_CA` when Render prompts, then deploy the Blueprint.
5. For a demo environment, add `MIGRATE_SEED=true` in the Render service environment and redeploy once. For a real salon, provision its tenant data instead of enabling the demo seed.
6. Copy the generated `RETELL_WEBHOOK_SECRET` value from Render into Retell's custom webhook header `x-retell-webhook-secret`.
7. Keep `CALENDAR_PROVIDER=local` for the Postgres-backed local calendar, or change it to `google`, add `GOOGLE_CALENDAR_ACCESS_TOKEN`, and provision real staff calendar IDs.
8. Do not set `PORT` manually unless needed; Render injects it. The API binds to `0.0.0.0:$PORT`.
9. Open `https://<service-name>.onrender.com/health` and confirm `database` is `postgres` and `calendarProvider` is the expected value before directing calls to the webhooks.

Render free web services sleep after inactivity and can take about a minute to wake. Render explicitly positions free instances for testing/hobby use rather than production; use an always-on paid instance before relying on this endpoint for time-sensitive live phone calls.

## Test and demo

```bash
npm test
```

The suite starts real HTTP listeners on ephemeral ports, sends requests through the webhook boundary, and queries the same live PGlite database for independent persistence evidence. It does not mock endpoint handlers or booking functions.

With an API already running:

```bash
RETELL_WEBHOOK_SECRET='...' node demo-call.mjs
```

Set `API_BASE_URL` if the server is not on port 3000.

## Calendar and workflow boundaries

Local calendar mode is the default. Google mode uses the Calendar FreeBusy and Events APIs and fails clearly at startup when `GOOGLE_CALENDAR_ACCESS_TOKEN` is absent; it never silently falls back to local mode.

Reminder plans and quiet-hours decisions are persisted, but this API does not run the outbound reminder delivery worker. Complaint alerts remain `stubbed` unless the tenant messaging configuration selects its live transport. Google OAuth login and refresh are external to this runtime; the adapter requires a current token.
