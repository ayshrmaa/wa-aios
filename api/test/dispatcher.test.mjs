import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { openDatabase } from "../src/database.mjs";
import { MessageDispatcher } from "../src/dispatcher.mjs";
import { NullTransport } from "../src/transport.mjs";
import { zonedDateTime } from "../src/time.mjs";

const tenantId = "11111111-1111-4111-8111-111111111111";
const quietNow = zonedDateTime("2026-01-14", "22:30", "Europe/Zurich");
const dayNow = zonedDateTime("2026-01-14", "14:00", "Europe/Zurich");
const dueNow = new Date(dayNow.getTime() - 60_000);
let opened;

const silentLogger = { log() {}, info() {}, warn() {}, error() {} };

class RecordingTransport {
  constructor({ fail = false } = {}) {
    this.fail = fail;
    this.sent = [];
  }

  async send(input) {
    this.sent.push(input);
    if (this.fail) throw new Error("simulated provider outage");
    return { status: "sent", provider: "test" };
  }
}

beforeEach(async () => {
  if (opened) await opened.db.close();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "wa-aios-dispatcher-"));
  opened = await openDatabase({ dataDir, databaseUrl: "", logger: silentLogger });
});

after(async () => {
  if (opened) await opened.db.close();
});

async function queuedMessage({
  channel = "email",
  emailConsent = true,
  whatsappConsent = true,
  templateId = "appointment_t_24h",
  scheduledFor = dueNow
} = {}) {
  const suffix = randomUUID().slice(0, 8);
  const contact = await opened.db.query(`
    insert into contacts (
      tenant_id, first_name, email, phone_e164, email_consent, whatsapp_consent, sms_consent, source
    ) values ($1::uuid, 'Lina', $4, $5, $2, $3, false, 'call')
    returning id::text
  `, [tenantId, emailConsent, whatsappConsent, `lina-${suffix}@example.test`, `+4179444${suffix.replace(/[^0-9]/g, "").padEnd(5, "0").slice(0, 5)}`]);
  const message = await opened.db.query(`
    insert into messages (
      tenant_id, contact_id, channel, direction, body, template_id, delivery_status, scheduled_for
    ) values ($1::uuid, $2::uuid, $3, 'outbound', 'Persisted message copy.', $4, 'queued', $5::timestamptz)
    returning id::text
  `, [tenantId, contact.rows[0].id, channel, templateId, scheduledFor.toISOString()]);
  return message.rows[0].id;
}

async function messageState(messageId) {
  const result = await opened.db.query(`
    select m.delivery_status, m.scheduled_for, m.sent_at, s.attempt_count, s.terminal_status, s.last_error
    from messages m
    left join message_dispatch_state s on s.message_id = m.id
    where m.id = $1::uuid
  `, [messageId]);
  return result.rows[0];
}

test("queued message dispatches exactly once when the worker runs twice", async () => {
  const messageId = await queuedMessage();
  const transport = new RecordingTransport();
  const firstWorker = new MessageDispatcher({ db: opened.db, transport, logger: silentLogger });
  const secondWorker = new MessageDispatcher({ db: opened.db, transport, logger: silentLogger });

  const first = await firstWorker.runOnce({ now: dayNow });
  const second = await secondWorker.runOnce({ now: new Date(dayNow.getTime() + 1_000) });
  const state = await messageState(messageId);

  assert.equal(first.sent, 1);
  assert.equal(second.claimed, 0);
  assert.equal(transport.sent.length, 1);
  assert.equal(state.delivery_status, "sent");
  assert.equal(state.attempt_count, 1);
});

test("a failing send retries with backoff and then becomes failed", async () => {
  const now = zonedDateTime("2026-01-14", "14:00", "Europe/Zurich");
  const messageId = await queuedMessage({ scheduledFor: new Date(now.getTime() - 1_000) });
  const transport = new RecordingTransport({ fail: true });
  const worker = new MessageDispatcher({
    db: opened.db,
    transport,
    logger: silentLogger,
    maxAttempts: 2,
    baseRetryMs: 1,
    maxRetryMs: 1
  });

  const first = await worker.runOnce({ now });
  const afterFirst = await messageState(messageId);
  const second = await worker.runOnce({ now: new Date(now.getTime() + 2) });
  const afterSecond = await messageState(messageId);

  assert.equal(first.retried, 1);
  assert.equal(afterFirst.delivery_status, "queued");
  assert.equal(afterFirst.attempt_count, 1);
  assert.equal(second.failed, 1);
  assert.equal(afterSecond.delivery_status, "failed");
  assert.equal(afterSecond.attempt_count, 2);
  assert.equal(afterSecond.terminal_status, "failed");
  assert.match(afterSecond.last_error, /simulated provider outage/);
  assert.equal(transport.sent.length, 2);
});

test("quiet hours drop T-2h messages and defer other messages", async () => {
  const dueInQuietHours = new Date(quietNow.getTime() - 60_000);
  const normalId = await queuedMessage({ templateId: "appointment_t_48h", scheduledFor: dueInQuietHours });
  const twoHourId = await queuedMessage({ templateId: "appointment_t_2h", scheduledFor: dueInQuietHours });
  const transport = new RecordingTransport();
  const worker = new MessageDispatcher({ db: opened.db, transport, logger: silentLogger });

  const result = await worker.runOnce({ now: quietNow });
  const normal = await messageState(normalId);
  const twoHour = await messageState(twoHourId);

  assert.equal(result.deferred, 1);
  assert.equal(result.dropped_quiet_hours, 1);
  assert.equal(transport.sent.length, 0);
  assert.equal(normal.delivery_status, "queued");
  assert.equal(new Date(normal.scheduled_for).toISOString(), zonedDateTime("2026-01-15", "08:00", "Europe/Zurich").toISOString());
  assert.equal(twoHour.delivery_status, "dropped_quiet_hours");
});

test("a contact without consent for the selected channel is never sent to", async () => {
  const now = zonedDateTime("2026-01-14", "14:00", "Europe/Zurich");
  const messageId = await queuedMessage({ emailConsent: false, scheduledFor: new Date(now.getTime() - 1_000) });
  const transport = new RecordingTransport();
  const worker = new MessageDispatcher({ db: opened.db, transport, logger: silentLogger });

  const result = await worker.runOnce({ now });
  const state = await messageState(messageId);

  assert.equal(result.failed, 1);
  assert.equal(transport.sent.length, 0);
  assert.equal(state.delivery_status, "failed");
  assert.match(state.last_error, /Missing email consent/);
});

test("NullTransport records stubbed and never marks a message sent", async () => {
  const now = zonedDateTime("2026-01-14", "14:00", "Europe/Zurich");
  const messageId = await queuedMessage({ scheduledFor: new Date(now.getTime() - 1_000) });
  const logs = [];
  const worker = new MessageDispatcher({
    db: opened.db,
    transport: new NullTransport({ logger: { log(line) { logs.push(line); } } }),
    logger: silentLogger
  });

  const result = await worker.runOnce({ now });
  const state = await messageState(messageId);

  assert.equal(result.stubbed, 1);
  assert.equal(state.delivery_status, "stubbed");
  assert.equal(state.sent_at, null);
  assert.ok(logs.some((line) => line.includes("message_would_send")));
});
