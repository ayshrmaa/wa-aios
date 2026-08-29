// Retell platform webhook. Retell POSTs call_started / call_ended /
// call_analyzed events with the recording URL, full transcript and structured
// post-call analysis. This is the source of truth for call records — the
// in-call `call_summary` tool is a best-effort fallback only.
//
// Auth: X-Retell-Signature (HMAC-SHA256 of the raw body with the Retell API
// key), or the shared x-retell-webhook-secret header.

import { createHmac, timingSafeEqual } from "node:crypto";
import { normalisePhone, firstNameOf } from "./leads.mjs";

const OUTCOME_MAP = {
  booked: "booked",
  appointment_booked: "booked",
  rescheduled: "rescheduled",
  cancelled: "cancelled",
  canceled: "cancelled",
  question_answered: "inquiry",
  inquiry: "inquiry",
  transferred: "transferred",
  complaint: "complaint",
  callback_requested: "callback",
  callback: "callback",
  voicemail: "voicemail",
  abandoned: "missed",
  spam: "spam"
};

export function verifyRetellSignature(rawBody, signatureHeader, apiKey) {
  if (!apiKey || !signatureHeader) return false;
  const expected = createHmac("sha256", apiKey).update(rawBody, "utf8").digest("hex");
  const provided = String(signatureHeader).replace(/^v=?/i, "").trim();
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class RetellWebhookService {
  constructor({ db, tenantLoader, leadService, logger = console, env = process.env }) {
    this.db = db;
    this.tenantLoader = tenantLoader;
    this.leads = leadService;
    this.logger = logger;
    this.env = env;
  }

  log(level, event, details = {}) {
    const sink = this.logger?.[level] ?? this.logger?.log;
    if (sink) sink.call(this.logger, JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...details }));
  }

  async handle(tenantId, payload) {
    const event = payload.event || payload.type || "unknown";
    const call = payload.call || payload.data || payload;
    const callId = call.call_id || call.callId;
    if (!callId) return { ok: false, error: "missing call_id" };

    const tenant = await this.tenantLoader(tenantId);
    const analysis = call.call_analysis || call.analysis || {};
    const custom = analysis.custom_analysis_data || analysis.customAnalysisData || {};

    const startedAt = call.start_timestamp ? new Date(call.start_timestamp) : new Date();
    const endedAt = call.end_timestamp ? new Date(call.end_timestamp) : null;
    const durationSeconds = call.duration_ms
      ? Math.round(call.duration_ms / 1000)
      : endedAt ? Math.max(0, Math.round((endedAt - startedAt) / 1000)) : 0;

    const direction = call.direction === "outbound" ? "outbound" : "inbound";
    const callerNumber = normalisePhone(direction === "outbound" ? call.to_number : call.from_number)
      || normalisePhone(custom.user_phone);

    const rawOutcome = String(custom.outcome || "").toLowerCase();
    const outcome = OUTCOME_MAP[rawOutcome]
      || (custom.appointment_booked ? "booked" : null)
      || (analysis.in_voicemail ? "voicemail" : null)
      || (call.disconnection_reason === "dial_no_answer" ? "missed" : null)
      || "inquiry";

    const answered = event !== "call_started"
      ? !(["missed", "voicemail"].includes(outcome)) && durationSeconds > 0
      : true;

    const result = await this.db.transaction(async (tx) => {
      let contactId = null;
      if (callerNumber || custom.user_email) {
        const email = String(custom.user_email || "").trim().toLowerCase();
        const existing = callerNumber
          ? (await tx.query("select id::text, first_name from contacts where tenant_id = $1::uuid and phone_e164 = $2", [tenant.id, callerNumber])).rows[0]
          : null;
        if (existing) {
          contactId = existing.id;
          if (custom.user_name && existing.first_name === "Gast") {
            await tx.query("update contacts set first_name = $2, updated_at = now() where id = $1::uuid", [contactId, firstNameOf(custom.user_name)]);
          }
        } else if (callerNumber) {
          contactId = (await tx.query(`
            insert into contacts (tenant_id, first_name, phone_e164, email, source, whatsapp_consent, email_consent,
                                  lifecycle_stage, last_interaction_at, last_interaction_kind)
            values ($1::uuid, $2, $3, nullif($4,''), 'call', false, ($4 <> ''), 'lead', $5::timestamptz, 'call')
            on conflict (tenant_id, phone_e164) do update set updated_at = now()
            returning id::text
          `, [tenant.id, firstNameOf(custom.user_name), callerNumber, email, startedAt.toISOString()])).rows[0].id;
        }
      }

      const transcript = typeof call.transcript === "string" ? call.transcript : null;
      const row = await tx.query(`
        insert into calls (
          tenant_id, contact_id, retell_call_id, started_at, ended_at, duration_seconds,
          answered, outcome, direction, from_number, to_number, transcript, transcript_object,
          recording_url, disclosure_played, summary, sentiment, user_sentiment, call_successful,
          in_voicemail, disconnection_reason, analysis, cost_cents
        ) values (
          $1::uuid, $2::uuid, $3, $4::timestamptz, $5::timestamptz, $6::int,
          $7::boolean, $8, $9, $10, $11, nullif($12,''), $13::jsonb,
          nullif($14,''), $15::boolean, nullif($16,''), $17, $18, $19::boolean,
          $20::boolean, $21, $22::jsonb, $23::int
        )
        on conflict (tenant_id, retell_call_id) do update set
          contact_id = coalesce(excluded.contact_id, calls.contact_id),
          ended_at = coalesce(excluded.ended_at, calls.ended_at),
          duration_seconds = greatest(excluded.duration_seconds, calls.duration_seconds),
          answered = excluded.answered or calls.answered,
          outcome = case when calls.outcome in ('missed','inquiry') then excluded.outcome else calls.outcome end,
          transcript = coalesce(excluded.transcript, calls.transcript),
          transcript_object = coalesce(excluded.transcript_object, calls.transcript_object),
          recording_url = coalesce(excluded.recording_url, calls.recording_url),
          disclosure_played = excluded.disclosure_played or calls.disclosure_played,
          summary = coalesce(excluded.summary, calls.summary),
          sentiment = coalesce(excluded.sentiment, calls.sentiment),
          user_sentiment = coalesce(excluded.user_sentiment, calls.user_sentiment),
          call_successful = coalesce(excluded.call_successful, calls.call_successful),
          in_voicemail = coalesce(excluded.in_voicemail, calls.in_voicemail),
          disconnection_reason = coalesce(excluded.disconnection_reason, calls.disconnection_reason),
          analysis = calls.analysis || excluded.analysis,
          cost_cents = coalesce(excluded.cost_cents, calls.cost_cents),
          from_number = coalesce(excluded.from_number, calls.from_number),
          to_number = coalesce(excluded.to_number, calls.to_number)
        returning id::text, contact_id::text
      `, [
        tenant.id, contactId, callId, startedAt.toISOString(), endedAt ? endedAt.toISOString() : null, durationSeconds,
        answered, outcome, direction, callerNumber || null, normalisePhone(call.to_number) || null,
        transcript || "", call.transcript_object ? JSON.stringify(call.transcript_object) : null,
        call.recording_url || "", custom.disclosure_played === true || custom.disclosure_played === "true",
        analysis.call_summary || custom.summary || "", analysis.sentiment || null, analysis.user_sentiment || null,
        typeof analysis.call_successful === "boolean" ? analysis.call_successful : null,
        typeof analysis.in_voicemail === "boolean" ? analysis.in_voicemail : null,
        call.disconnection_reason || null,
        JSON.stringify({ event, custom, agent_id: call.agent_id, public_log_url: call.public_log_url }),
        call.call_cost?.combined_cost != null ? Math.round(Number(call.call_cost.combined_cost)) : null
      ]);

      const persisted = row.rows[0];

      if (contactId && event !== "call_started") {
        await tx.query(`
          update contacts set last_interaction_at = greatest(coalesce(last_interaction_at,'-infinity'::timestamptz), $2::timestamptz),
                              last_interaction_kind = 'call', updated_at = now()
          where id = $1::uuid
        `, [contactId, startedAt.toISOString()]);
        await tx.query(`
          insert into contact_notes (tenant_id, contact_id, author, kind, body, metadata)
          values ($1::uuid, $2::uuid, 'ai', 'call', $3, $4::jsonb)
        `, [tenant.id, contactId,
            `Call (${outcome}, ${durationSeconds}s): ${(analysis.call_summary || custom.summary || "no summary").slice(0, 200)}`,
            JSON.stringify({ callId: persisted.id, retellCallId: callId, recordingUrl: call.recording_url || null })]);
      }

      await tx.query(`
        insert into events (tenant_id, aggregate_type, aggregate_id, event_type, source, payload)
        values ($1::uuid, 'call', $2::uuid, $3, 'retell.webhook', $4::jsonb)
      `, [tenant.id, persisted.id, `call.${event}`, JSON.stringify({ outcome, direction, durationSeconds })]);

      return { callDbId: persisted.id, contactId, outcome };
    });

    // A completed call that did NOT book, from a reachable caller, becomes a
    // lead so the standard follow-up ladder chases it.
    if (
      event === "call_analyzed"
      && this.leads
      && callerNumber
      && ["inquiry", "callback", "missed", "voicemail"].includes(result.outcome)
      && !custom.complaint_raised
    ) {
      try {
        await this.leads.createLead(tenant.id, {
          source: "call",
          name: custom.user_name || "",
          phone: callerNumber,
          email: custom.user_email || undefined,
          serviceInterest: custom.service || undefined,
          urgency: "this_week",
          notes: `From phone call ${callId}. ${(analysis.call_summary || "").slice(0, 300)}`
        });
      } catch (error) {
        this.log("warn", "retell_call_lead_failed", { message: error.message, callId });
      }
    }

    this.log("info", "retell_webhook_handled", { event, callId, outcome: result.outcome, contactLinked: Boolean(result.contactId) });
    return { ok: true, event, callId, ...result };
  }
}
