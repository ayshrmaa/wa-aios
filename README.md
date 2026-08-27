# Work Artificial — AIOS

An AI receptionist and follow-up system for Swiss beauty and hair salons.

A caller phones the salon. An AI agent answers, checks a stylist's real availability,
books the appointment, and logs the call. Reminders go out before the appointment,
recovery messages go out after a no-show, and a review request goes out after a visit.
The owner sees all of it on a dashboard.

Built against the Work Artificial AIOS Operational Briefing v2.0. See [SPEC.md](SPEC.md).

---

## Start here

```bash
git clone <this repo>
cd wa-aios/api && npm install && npm start
```

That boots the booking API on an embedded database with demo data. No credentials needed.
Then, in another terminal:

```bash
cd api && npm test
```

30 tests. They exercise a live HTTP server against a real database — booking, the
double-booking race, per-stylist calendars, closures, no-show inference, reminder
scheduling, message dispatch, lead follow-up ladders, ManyChat intake, Google auth,
and the dashboard API. If these pass, the core works.

---

## What's in here

| Directory | What it is | State |
|---|---|---|
| `api/` | Booking engine, lead follow-up, message dispatcher, dashboard API. The heart of the system. | Working, 30 tests passing |
| `retell/` | Voice agent prompt and config for Retell | Working, deployed |
| `dashboard/` | Owner app: overview, appointments, calls, leads pipeline, reviews & complaints, messages. Login-protected, live from the API. | Working |
| `website-template/` | Salon landing page with a browser "talk to the receptionist" button | Working |
| `audit-generator/` | Sales tool: discovery inputs → branded PDF | Working |
| `workflows/` | n8n workflows (alternative to `api/` for no-code editing) | Valid, unused by default |
| `db/` | Schema, seed data, migrations | Working |
| `compliance/` | Five Swiss legal document drafts | Drafts — need a lawyer |
| `onboarding/` | Client intake form and go-live checklist | Written |
| `manychat/` | Instagram/WhatsApp: DM → lead webhook, follow-up DMs via ManyChat API, flow runbook | Code done, blocked on Meta |
| `config/tenant.demo.json` | Every salon-specific value. One file per client. | — |

**Installing this into a real salon: follow "Install into a new business" in
[`api/CONFIGURATION.md`](api/CONFIGURATION.md).** Ten ordered steps, every one a command in this repo. It lists
every external service, where the credential comes from, which environment variable it
goes in, and what breaks when it's missing.

---

## What works without any credentials

Everything above runs locally on an embedded database with a seeded demo salon
("Atelier Nova", Zurich). Bookings persist, the dashboard renders, the PDF generates,
messages queue. You can evaluate the whole system before signing up for anything.

Messages queue but do not send, because no transport is configured. That is deliberate
and visible — `NullTransport` logs exactly what it would have sent and marks the message
`stubbed`. It never pretends to have delivered anything.

## What needs credentials

| To make this real | You need | Cost |
|---|---|---|
| Bookings in a real calendar | Google Calendar OAuth | Free |
| Reminders and review requests actually sending | Resend API key | Free to 3,000/mo |
| Instagram DM follow-ups | ManyChat API key (after Meta verification) | ManyChat Pro |
| Owner dashboard on live data | `DASHBOARD_API_TOKEN` on both sides + `DASHBOARD_PASSWORD` | Free |
| Data that survives a restart | Postgres — Supabase, **EU region** | Free tier |
| The agent answering a real phone | Retell key + a number | ~$0.10/min, $2/mo per number |

Set the environment variable, restart, done. No code changes.

## What is genuinely blocked

- **WhatsApp** — the adapter is written, but Meta must verify the business and approve
  every message template. Days to weeks, and it needs a real legal entity.
- **Instagram DMs** — same verification, plus Facebook Page admin access.
- **A Swiss (+41) number** — Retell sells US and Canadian numbers only. A real Swiss line
  means a Twilio number SIP-trunked into Retell.

None of these are code problems. Nothing in this repo unblocks them.

---

## Deploying

- **Dashboard and website → Vercel.** Both are Next.js. Free tier is fine.
- **Database → Supabase**, Frankfurt or Zurich region. Swiss data protection law (revDSG)
  expects EU residency.
- **API → a host that does not sleep.** This matters more than it sounds. Free tiers that
  idle out take ~50 seconds to wake. A caller asks for Tuesday at 2pm, the agent calls
  `check_availability`, the API is asleep, the call times out and the caller hangs up.
  A salon line is idle most of the day, so this is the normal case, not an edge case.
  Budget for an always-warm instance. `api/render.yaml` is included.

---

## Things you should know before trusting this

- **The compliance documents are drafts, not legal advice.** A Swiss-qualified lawyer must
  read all five before a client signs. The transfer basis for US-hosted sub-processors in
  the DPA is the part most likely to be wrong.
- **Review gating is off by default and should probably stay off.** The brief asks for happy
  clients to be sent to Google and unhappy ones to a private form. That is against Google's
  review policy and businesses have lost their entire review history for it. The toggle is
  `review.gate_enabled`.
- **Recovered revenue on the dashboard is an estimate**, labelled as one in the UI. It is
  recovered appointments × average appointment value. Do not present it as measured.
- **Salons on Fresha or Booksy cannot have live booking.** Fresha has no public API, only a
  read-only data connector. Booksy's is contact-gated. This system replaces the booking
  platform rather than integrating with it — the salon moves to Google Calendar. Tier a
  prospect honestly at the point of sale.

---

## Operator commands (repo root)

| Command | What it does |
|---|---|
| `npm run install:all` | installs every package |
| `npm run doctor` | checks API, auth, Retell agent + tool reachability, calendar, transport. `-- --build` adds the Next.js builds |
| `npm run dev:up` | local end-to-end: API + public tunnel + re-points the agent |
| `npm run retell:provision` | creates or updates the voice agent from `retell/` + tenant config |
| `npm run retell:sync` | re-points the agent's tool URLs after the API moves |
| `npm run google:consent` | one-time Google Calendar authorisation → refresh token |
| `npm run seed:regenerate` | rebuilds demo data and the dashboard snapshot, runs consistency assertions |
| `npm test` | 30 tests against a live API server and real database |
