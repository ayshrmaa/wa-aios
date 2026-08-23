import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createRuntime } from "../server.mjs";
import {
  addDateKey,
  localDateKey,
  swissHolidaySet,
  weekdayForDateKey,
  zonedDateTime
} from "../src/time.mjs";

const tenantId = "11111111-1111-4111-8111-111111111111";
const timezone = "Europe/Zurich";
let runtime;
let socketPath;
const webhookSecret = "e2e-retell-webhook-secret";

function futureWeekday(weekday, minimumDays) {
  const today = localDateKey(new Date(), timezone);
  for (let offset = minimumDays; offset < minimumDays + 30; offset += 1) {
    const candidate = addDateKey(today, offset);
    if (weekdayForDateKey(candidate) === weekday) return candidate;
  }
  throw new Error(`Could not find future ${weekday}`);
}

function futureBookableWeekday(weekday, minimumDays) {
  const today = localDateKey(new Date(), timezone);
  for (let offset = minimumDays; offset < minimumDays + 60; offset += 1) {
    const candidate = addDateKey(today, offset);
    const year = Number(candidate.slice(0, 4));
    if (weekdayForDateKey(candidate) !== weekday) continue;
    if (swissHolidaySet(year, "ZH").has(candidate)) continue;
    if (["2026-12-24", "2026-12-31"].includes(candidate)) continue;
    return candidate;
  }
  throw new Error(`Could not find bookable future ${weekday}`);
}

function futureOpenHoliday() {
  const currentYear = Number(localDateKey(new Date(), timezone).slice(0, 4));
  for (let year = currentYear; year < currentYear + 6; year += 1) {
    for (const dateKey of swissHolidaySet(year, "ZH")) {
      if (dateKey <= localDateKey(new Date(), timezone)) continue;
      const weekday = weekdayForDateKey(dateKey);
      if (["tuesday", "wednesday", "thursday", "friday", "saturday"].includes(weekday)) {
        return dateKey;
      }
    }
  }
  throw new Error("Could not find a future Swiss holiday on a configured opening weekday.");
}

function openingTime(dateKey) {
  return weekdayForDateKey(dateKey) === "thursday" ? "10:00" : weekdayForDateKey(dateKey) === "saturday" ? "09:00" : "10:00";
}

function at(dateKey, time) {
  return zonedDateTime(dateKey, time, timezone).toISOString();
}

async function request(socket, pathname, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const clientRequest = http.request({ socketPath: socket, path: pathname, method, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        text: Buffer.concat(chunks).toString("utf8")
      }));
    });
    clientRequest.on("error", reject);
    clientRequest.end(body);
  });
}

async function post(endpoint, body) {
  const payload = JSON.stringify(body);
  const response = await request(socketPath, `/webhook/${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
      "x-retell-webhook-secret": webhookSecret
    },
    body: payload
  });
  assert.equal(response.status, 200, `${endpoint} HTTP ${response.status}: ${response.text}`);
  return JSON.parse(response.text);
}

before(async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "wa-aios-e2e-"));
  socketPath = `/tmp/wa-aios-e2e-${process.pid}.sock`;
  runtime = await createRuntime({
    dataDir,
    socketPath,
    calendarProvider: "local",
    databaseUrl: "",
    noShowSweepIntervalMs: 50,
    env: {
      ...process.env,
      RETELL_WEBHOOK_SECRET: webhookSecret,
      RATE_LIMIT_MAX: "500"
    },
    logger: { log() {}, error() {} }
  });
  await runtime.start();
  const health = JSON.parse((await request(socketPath, "/health")).text);
  assert.deepEqual(
    { status: health.status, database: health.database, calendarProvider: health.calendarProvider },
    { status: "ok", database: "pglite", calendarProvider: "local" }
  );
  console.log(`EVIDENCE server=${JSON.stringify(health)}`);
});

after(async () => {
  if (runtime) await runtime.close();
});

test("a. booking persists in both the canonical DB and the local calendar", async () => {
  const startTime = at(futureBookableWeekday("tuesday", 70), "10:00");
  const request = {
    startTime,
    serviceId: "cut-and-finish",
    staffId: "mara",
    customerName: "E2E Alpha",
    customerPhone: "+41794440001",
    customerEmail: "alpha@example.test"
  };
  const available = await post("check-availability", {
    startTime,
    serviceId: request.serviceId,
    staffId: request.staffId
  });
  assert.equal(available.available, true);
  const booking = await post("book-appointment", request);
  assert.equal(booking.status, "booked");
  const persisted = await runtime.db.query(`
    select a.id::text, a.status, a.starts_at, a.ends_at, a.external_id,
           count(c.id)::int as calendar_events
    from appointments a
    left join local_calendar_events c
      on c.tenant_id = a.tenant_id and c.external_id = a.external_id
    where a.id = $1::uuid
    group by a.id
  `, [booking.appointmentId]);
  assert.equal(persisted.rows[0].status, "booked");
  assert.equal(persisted.rows[0].calendar_events, 1);
  console.log(`EVIDENCE a=${JSON.stringify({ available, booking, database: persisted.rows[0] })}`);
});

test("b. two truly simultaneous bookings for one staff slot produce exactly one clean failure", async () => {
  const startTime = at(futureBookableWeekday("wednesday", 78), "10:00");
  const common = { startTime, serviceId: "cut-and-finish", staffId: "lea", customerName: "Race" };
  const [first, second] = await Promise.all([
    post("book-appointment", { ...common, customerPhone: "+41794440002" }),
    post("book-appointment", { ...common, customerPhone: "+41794440003" })
  ]);
  const successes = [first, second].filter((result) => result.status === "booked");
  const failures = [first, second].filter((result) => result.status === "not_booked");
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, "slot_taken");
  assert.equal(typeof failures[0].message, "string");
  assert.ok(failures[0].message.length > 20);
  const count = await runtime.db.query(`
    select count(*)::int as booked
    from appointments
    where tenant_id = $1::uuid and staff_calendar_id = $2
      and starts_at = $3::timestamptz and status = 'booked'
  `, [tenantId, "lea.atelier-nova@calendar.demo", startTime]);
  assert.equal(count.rows[0].booked, 1);
  console.log(`EVIDENCE b=${JSON.stringify({ parallelResponses: [first, second], databaseBookedCount: count.rows[0].booked })}`);
});

test("c. different stylists can book the same clock time", async () => {
  const startTime = at(futureBookableWeekday("thursday", 86), "12:00");
  const [lea, noemi] = await Promise.all([
    post("book-appointment", {
      startTime, serviceId: "cut-and-finish", staffId: "lea",
      customerName: "Parallel Lea", customerPhone: "+41794440004"
    }),
    post("book-appointment", {
      startTime, serviceId: "cut-and-finish", staffId: "noemi",
      customerName: "Parallel Noemi", customerPhone: "+41794440005"
    })
  ]);
  assert.equal(lea.status, "booked");
  assert.equal(noemi.status, "booked");
  const count = await runtime.db.query(`
    select count(*)::int as booked, count(distinct staff_calendar_id)::int as calendars
    from appointments where id in ($1::uuid, $2::uuid) and status = 'booked'
  `, [lea.appointmentId, noemi.appointmentId]);
  assert.deepEqual(count.rows[0], { booked: 2, calendars: 2 });
  console.log(`EVIDENCE c=${JSON.stringify({ responses: [lea, noemi], database: count.rows[0] })}`);
});

test("d. weekly closure, tenant closure date, Swiss holiday, and outside hours are rejected", async () => {
  const monday = futureWeekday("monday", 94);
  const closure = futureWeekday("tuesday", 102);
  const outsideHours = futureBookableWeekday("wednesday", 108);
  await runtime.db.query(`
    update tenants
    set adapter_config = jsonb_set(
      adapter_config,
      '{closureDates}',
      (adapter_config->'closureDates') || to_jsonb($2::text)
    )
    where id = $1::uuid
  `, [tenantId, closure]);
  const holiday = futureOpenHoliday();
  const cases = [
    { label: "weekly_closed_monday", startTime: at(monday, "10:00") },
    { label: "tenant_closure", startTime: at(closure, "10:00") },
    { label: "swiss_holiday", startTime: at(holiday, openingTime(holiday)) },
    { label: "outside_opening_hours", startTime: at(outsideHours, "08:30") }
  ];
  const responses = [];
  for (const item of cases) {
    const response = await post("book-appointment", {
      startTime: item.startTime,
      serviceId: "cut-and-finish",
      staffId: "mara",
      customerName: "Closed Day",
      customerPhone: `+4179444${responses.length + 10}000`
    });
    assert.equal(response.status, "not_booked");
    assert.equal(response.code, "closed");
    responses.push({ ...item, response });
  }
  console.log(`EVIDENCE d=${JSON.stringify(responses)}`);
});

test("e. the seeded Balayage service blocks its full 150-minute duration", async () => {
  const dateKey = futureBookableWeekday("friday", 116);
  const startTime = at(dateKey, "12:00");
  const booking = await post("book-appointment", {
    startTime,
    serviceId: "balayage",
    staffId: "mara",
    customerName: "Balayage Client",
    customerPhone: "+41794440020"
  });
  assert.equal(booking.status, "booked");
  assert.equal(new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime(), 150 * 60_000);
  const during = await post("check-availability", {
    startTime: at(dateKey, "14:00"), serviceId: "cut-and-finish", staffId: "mara"
  });
  const boundary = await post("check-availability", {
    startTime: at(dateKey, "14:30"), serviceId: "cut-and-finish", staffId: "mara"
  });
  assert.equal(during.available, false);
  assert.equal(boundary.available, true);
  const row = await runtime.db.query(`
    select extract(epoch from (ends_at - starts_at))::int / 60 as duration_minutes
    from appointments where id = $1::uuid
  `, [booking.appointmentId]);
  assert.equal(row.rows[0].duration_minutes, 150);
  console.log(`EVIDENCE e=${JSON.stringify({ booking, during, boundary, database: row.rows[0] })}`);
});

test("f. find, reschedule, and cancel round trip leaves DB and calendar consistent", async () => {
  const phone = "+41794440030";
  const original = at(futureBookableWeekday("saturday", 126), "09:00");
  const replacement = at(futureBookableWeekday("tuesday", 134), "11:00");
  const booking = await post("book-appointment", {
    startTime: original, serviceId: "cut-and-finish", staffId: "noemi",
    customerName: "Round Trip", customerPhone: phone
  });
  assert.equal(booking.status, "booked");
  const found = await post("find-appointment", { customerPhone: "+41 (79) 444-00-30" });
  assert.ok(found.appointments.some((item) => item.appointmentId === booking.appointmentId));
  const rescheduled = await post("reschedule-appointment", {
    appointmentId: booking.appointmentId,
    newStartTime: replacement
  });
  assert.equal(rescheduled.status, "rescheduled");
  const cancelled = await post("cancel-appointment", {
    appointmentId: booking.appointmentId,
    reason: "E2E round-trip proof"
  });
  assert.equal(cancelled.status, "cancelled");
  const state = await runtime.db.query(`
    select a.status, a.starts_at, a.ends_at,
           (select count(*)::int from local_calendar_events c
            where c.tenant_id = a.tenant_id and c.external_id = a.external_id) as calendar_events,
           (select count(*)::int from sequence_runs s
            where s.appointment_id = a.id and s.status = 'active') as active_reminders
    from appointments a where a.id = $1::uuid
  `, [booking.appointmentId]);
  assert.equal(state.rows[0].status, "cancelled");
  assert.equal(new Date(state.rows[0].starts_at).toISOString(), replacement);
  assert.equal(state.rows[0].calendar_events, 0);
  assert.equal(state.rows[0].active_reminders, 0);
  console.log(`EVIDENCE f=${JSON.stringify({ booking, found, rescheduled, cancelled, database: state.rows[0] })}`);
});

test("g. the live no-show detector infers a booked appointment 30+ minutes past start", async () => {
  const phone = "+41794440040";
  const call = await post("log-call", {
    customerName: "No Show Fixture",
    customerPhone: phone,
    summary: "Created the contact through the live endpoint before no-show detection.",
    outcome: "question_answered",
    disclosurePlayed: true
  });
  assert.equal(call.logged, true);
  const contact = await runtime.db.query("select id::text from contacts where tenant_id = $1::uuid and phone_e164 = $2", [tenantId, phone]);
  const appointmentId = randomUUID();
  const externalId = `local-${randomUUID()}`;
  const startsAt = new Date(Date.now() - 40 * 60_000).toISOString();
  const endsAt = new Date(Date.now() + 20 * 60_000).toISOString();
  await runtime.db.transaction(async (tx) => {
    await tx.query(`
      insert into appointments (
        id, tenant_id, contact_id, external_id, platform, status, status_source,
        starts_at, ends_at, service, value_chf, staff, staff_calendar_id, lead_source
      ) values (
        $1::uuid, $2::uuid, $3::uuid, $4, 'local', 'booked', 'workflow',
        $5::timestamptz, $6::timestamptz, 'Cut & Finish', 118, 'Lea', $7, 'call'
      )
    `, [appointmentId, tenantId, contact.rows[0].id, externalId, startsAt, endsAt, "lea.atelier-nova@calendar.demo"]);
    await tx.query(`
      insert into local_calendar_events (
        tenant_id, external_id, calendar_id, starts_at, ends_at, summary
      ) values ($1::uuid, $2, $3, $4::timestamptz, $5::timestamptz, 'No-show detector fixture')
    `, [tenantId, externalId, "lea.atelier-nova@calendar.demo", startsAt, endsAt]);
  });
  const health = JSON.parse((await request(socketPath, "/health")).text);
  const state = await runtime.db.query(`
    select status, status_source,
           (select count(*)::int from events where aggregate_id = $1::uuid and event_type = 'appointment.no_show_inferred') as audit_events
    from appointments where id = $1::uuid
  `, [appointmentId]);
  assert.deepEqual(state.rows[0], { status: "no_show", status_source: "inferred", audit_events: 1 });
  console.log(`EVIDENCE g=${JSON.stringify({ call, health, appointmentId, database: state.rows[0] })}`);
});

test("h. reminder plans contain exact T-48h/T-24h/T-2h times and drop quiet-hours T-2h", async () => {
  const startTime = at(futureBookableWeekday("tuesday", 150), "09:00");
  const booking = await post("book-appointment", {
    startTime, serviceId: "cut-and-finish", staffId: "lea",
    customerName: "Reminder Client", customerPhone: "+41794440050",
    customerEmail: "reminder@example.test"
  });
  assert.equal(booking.status, "booked");
  const messages = await runtime.db.query(`
    select template_id, delivery_status, scheduled_for
    from messages
    where appointment_id = $1::uuid
      and template_id in ('appointment_t_48h', 'appointment_t_24h', 'appointment_t_2h')
    order by scheduled_for
  `, [booking.appointmentId]);
  assert.equal(messages.rows.length, 3);
  const byTemplate = Object.fromEntries(messages.rows.map((row) => [row.template_id, row]));
  for (const [template, hours] of [["appointment_t_48h", 48], ["appointment_t_24h", 24], ["appointment_t_2h", 2]]) {
    assert.equal(
      new Date(byTemplate[template].scheduled_for).toISOString(),
      new Date(new Date(startTime).getTime() - hours * 3_600_000).toISOString()
    );
  }
  assert.equal(byTemplate.appointment_t_48h.delivery_status, "queued");
  assert.equal(byTemplate.appointment_t_24h.delivery_status, "queued");
  assert.equal(byTemplate.appointment_t_2h.delivery_status, "dropped_quiet_hours");
  const active = await runtime.db.query(`
    select current_step, next_fire_at, metadata
    from sequence_runs where appointment_id = $1::uuid and status = 'active'
    order by current_step
  `, [booking.appointmentId]);
  assert.equal(active.rows.length, 2);
  console.log(`EVIDENCE h=${JSON.stringify({ booking, messages: messages.rows, activeSequenceRuns: active.rows })}`);
});

test("i. complaint persistence alerts only the owner and never creates a customer reply", async () => {
  const phone = "+41794440060";
  const response = await post("log-complaint", {
    customerPhone: phone,
    customerName: "Complaint Client",
    summary: "The colour result is not what I requested.",
    severity: "high"
  });
  assert.equal(response.logged, true);
  assert.equal(response.ownerAlert, "stubbed");
  assert.equal(response.automatedCustomerReply, false);
  assert.equal("message" in response, false);
  const complaint = await runtime.db.query(`
    select c.id::text, c.severity, c.body, c.notified_at, c.contact_id::text,
           (select count(*)::int from messages m
            where m.template_id = 'complaint_owner_alert'
              and m.body like '%owner@atelier-nova.example%'
              and m.contact_id is null) as owner_alerts,
           (select count(*)::int from messages m
            where m.contact_id = c.contact_id and m.created_at >= c.created_at) as customer_messages
    from complaints c where c.id = $1::uuid
  `, [response.complaintId]);
  assert.equal(complaint.rows[0].severity, "high");
  assert.equal(complaint.rows[0].owner_alerts, 1);
  assert.equal(complaint.rows[0].customer_messages, 0);
  assert.equal(complaint.rows[0].notified_at, null);
  console.log(`EVIDENCE i=${JSON.stringify({ response, database: complaint.rows[0] })}`);
});

test("all eight Retell endpoints include a persisted callback request", async () => {
  const response = await post("log-callback", {
    customerPhone: "+41794440070",
    customerName: "Callback Client",
    reason: "Please call about colour correction."
  });
  assert.equal(response.logged, true);
  const event = await runtime.db.query(`
    select id::text, aggregate_type, event_type, payload
    from events where id = $1::bigint
  `, [response.callbackRequestId]);
  assert.equal(event.rows[0].aggregate_type, "callback_request");
  assert.equal(event.rows[0].event_type, "callback.requested");
  console.log(`EVIDENCE endpoint_coverage=${JSON.stringify({ response, database: event.rows[0] })}`);
});

test("webhook authentication rejects a missing shared secret with a caller-safe response", async () => {
  const payload = "{}";
  const response = await request(socketPath, "/webhook/check-availability", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
    body: payload
  });
  const body = JSON.parse(response.text);
  assert.equal(response.status, 401);
  assert.equal(body.error, "unauthorized");
  assert.equal(typeof body.message, "string");
  assert.equal(typeof body.requestId, "string");
  assert.equal("stack" in body, false);
  assert.equal(response.headers["x-request-id"], body.requestId);
  console.log(`EVIDENCE webhook_auth=${JSON.stringify({ status: response.status, body })}`);
});

test("per-IP rate limiting returns 429 from a live HTTP server", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "wa-aios-rate-limit-"));
  const limitedSocketPath = `/tmp/wa-aios-rate-${process.pid}.sock`;
  const limitedRuntime = await createRuntime({
    dataDir,
    databaseUrl: "",
    socketPath: limitedSocketPath,
    calendarProvider: "local",
    rateLimitMax: 2,
    noShowSweepIntervalMs: 60_000,
    env: { ...process.env, RETELL_WEBHOOK_SECRET: webhookSecret },
    logger: { log() {}, error() {} }
  });
  try {
    await limitedRuntime.start();
    const statuses = [];
    for (let requestNumber = 0; requestNumber < 3; requestNumber += 1) {
      statuses.push((await request(limitedSocketPath, "/health")).status);
    }
    assert.deepEqual(statuses, [200, 200, 429]);
    console.log(`EVIDENCE rate_limit=${JSON.stringify({ statuses })}`);
  } finally {
    await limitedRuntime.close();
  }
});
