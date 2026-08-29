// Inbound customer messages (SMS / WhatsApp / email / Instagram) and the AI
// conversation that handles them. Every inbound message immediately stops any
// running follow-up or reactivation sequence for that contact ("stop the moment
// the customer responds"). If the AI is enabled it then replies, can check
// availability, and can book — otherwise the thread is flagged for a human.

import { salonPersona } from "./ai.mjs";
import { normalisePhone, firstNameOf } from "./leads.mjs";

const MAX_TOOL_ITERATIONS = 4;
const HISTORY_LIMIT = 20;

function clientError(message, code = "invalid_request") {
  return Object.assign(new Error(message), { statusCode: 400, code });
}

const CONVERSATION_TOOLS = [
  {
    name: "check_availability",
    description: "Check whether the salon can offer a specific service at a specific date and time. Call before promising any slot.",
    input_schema: {
      type: "object",
      required: ["service", "startTime"],
      properties: {
        service: { type: "string", description: "Exact service name from the salon menu." },
        startTime: { type: "string", description: "Requested start as ISO8601 with the salon's UTC offset, e.g. 2026-09-03T14:00:00+02:00" }
      }
    }
  },
  {
    name: "book_appointment",
    description: "Book the appointment. Only after check_availability confirmed the slot and the customer agreed. Needs their name.",
    input_schema: {
      type: "object",
      required: ["service", "startTime", "customerName"],
      properties: {
        service: { type: "string" },
        startTime: { type: "string", description: "Confirmed ISO8601 start with offset." },
        customerName: { type: "string" },
        notes: { type: "string" }
      }
    }
  },
  {
    name: "escalate_to_human",
    description: "Hand the conversation to salon staff (complaint, refund, medical/allergy question, anything you cannot resolve).",
    input_schema: { type: "object", properties: { reason: { type: "string" } } }
  },
  {
    name: "close_conversation",
    description: "The customer is done and needs nothing further, or clearly is not interested.",
    input_schema: { type: "object", properties: { outcome: { type: "string", enum: ["resolved", "not_interested"] } } }
  }
];

export class ConversationService {
  constructor({ db, bookingService, leadService, ai, tenantLoader, logger = console, now = () => new Date() }) {
    this.db = db;
    this.booking = bookingService;
    this.leads = leadService;
    this.ai = ai;
    this.tenantLoader = tenantLoader;
    this.logger = logger;
    this.now = now;
  }

  log(level, event, details = {}) {
    const sink = this.logger?.[level] ?? this.logger?.log;
    if (sink) sink.call(this.logger, JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...details }));
  }

  async resolveContact(client, tenantId, body) {
    const phone = normalisePhone(body.from || body.phone || body.customerPhone);
    const email = String(body.email || body.customerEmail || "").trim().toLowerCase() || null;
    const subscriberId = body.subscriberId || body.subscriber_id || null;
    const name = String(body.name || body.customerName || "").trim();

    let row = null;
    if (phone) {
      row = (await client.query("select * from contacts where tenant_id = $1::uuid and phone_e164 = $2", [tenantId, phone])).rows[0] || null;
    }
    if (!row && subscriberId) {
      row = (await client.query("select * from contacts where tenant_id = $1::uuid and manychat_subscriber_id = $2", [tenantId, subscriberId])).rows[0] || null;
    }
    if (!row && email) {
      row = (await client.query("select * from contacts where tenant_id = $1::uuid and lower(email) = $2", [tenantId, email])).rows[0] || null;
    }
    if (row) return row;

    if (!phone && !email && !subscriberId) throw clientError("An inbound message needs a phone, email, or subscriber id.");
    const source = body.channel === "instagram" ? "instagram" : body.channel === "whatsapp" ? "whatsapp" : phone ? "call" : "website";
    const inserted = await client.query(`
      insert into contacts (tenant_id, first_name, phone_e164, email, source, manychat_subscriber_id,
                             whatsapp_consent, email_consent, lifecycle_stage, last_interaction_at, last_interaction_kind)
      values ($1::uuid, $2, $3, nullif($4,''), $5, $6, $7, ($4 <> ''), 'lead', now(), 'message')
      returning *
    `, [tenantId, firstNameOf(name), phone, email || "", source, subscriberId,
        body.channel === "whatsapp" || body.channel === "sms"]);
    return inserted.rows[0];
  }

  channelFor(body, contact) {
    const c = String(body.channel || "").toLowerCase();
    if (["whatsapp", "sms", "email", "instagram"].includes(c)) return c;
    if (contact.manychat_subscriber_id) return "instagram";
    if (contact.email) return "email";
    return "whatsapp";
  }

  async handleInbound(tenantId, body) {
    const tenant = await this.tenantLoader(tenantId);
    const text = String(body.text || body.message || body.body || "").trim();
    if (!text) throw clientError("Inbound message text is empty.");

    const prepared = await this.db.transaction(async (tx) => {
      const contact = await this.resolveContact(tx, tenant.id, body);
      const channel = this.channelFor(body, contact);
      const conversation = (await tx.query(`
        insert into conversations (tenant_id, contact_id, channel, status, last_message_at, last_direction, last_inbound_at, unread_count)
        values ($1::uuid, $2::uuid, $3, 'ai_handling', now(), 'inbound', now(), 1)
        on conflict (tenant_id, contact_id, channel) do update set
          status = case when conversations.status = 'closed' then 'ai_handling' else conversations.status end,
          last_message_at = now(), last_direction = 'inbound', last_inbound_at = now(),
          unread_count = conversations.unread_count + 1, updated_at = now()
        returning *
      `, [tenant.id, contact.id, channel])).rows[0];

      await tx.query(`
        insert into messages (tenant_id, contact_id, conversation_id, channel, direction, body, delivery_status, created_at)
        values ($1::uuid, $2::uuid, $3::uuid, $4, 'inbound', $5, 'received', now())
      `, [tenant.id, contact.id, conversation.id, channel, text]);

      await tx.query(`
        update contacts set last_interaction_at = now(), last_interaction_kind = 'message', updated_at = now()
        where id = $1::uuid
      `, [contact.id]);
      await tx.query(`
        insert into contact_notes (tenant_id, contact_id, author, kind, body, metadata)
        values ($1::uuid, $2::uuid, 'system', 'message', $3, $4::jsonb)
      `, [tenant.id, contact.id, `Inbound ${channel}: ${text.slice(0, 140)}`, JSON.stringify({ conversationId: conversation.id })]);

      // Stop the moment the customer responds.
      const stoppedMessages = await tx.query(`
        update messages set delivery_status = 'failed'
        where tenant_id = $1::uuid and contact_id = $2::uuid and direction = 'outbound' and delivery_status = 'queued'
          and (template_id like 'lead_%' or template_id like 'reactivation_%')
        returning id
      `, [tenant.id, contact.id]);
      await tx.query(`
        update sequence_runs set status = 'exited', exit_reason = 'customer_replied', next_fire_at = null, updated_at = now()
        where tenant_id = $1::uuid and contact_id = $2::uuid and status = 'active'
          and sequence_type in ('lead_follow_up', 're_engagement', 'reactivation')
      `, [tenant.id, contact.id]);
      await tx.query(`
        update leads set status = 'qualified', updated_at = now()
        where tenant_id = $1::uuid and contact_id = $2::uuid and status in ('new', 'contacted')
      `, [tenant.id, contact.id]);
      await tx.query(`
        update reactivation_targets set status = 'responded', responded_at = now(), updated_at = now()
        where tenant_id = $1::uuid and contact_id = $2::uuid and status in ('sent', 'queued')
      `, [tenant.id, contact.id]);
      await tx.query(`
        update reactivation_campaigns c set responses = responses + 1, updated_at = now()
        where c.tenant_id = $1::uuid and exists (
          select 1 from reactivation_targets t
          where t.campaign_id = c.id and t.contact_id = $2::uuid and t.responded_at >= now() - interval '5 seconds'
        )
      `, [tenant.id, contact.id]);

      const history = (await tx.query(`
        select direction, body, created_at from messages
        where tenant_id = $1::uuid and conversation_id = $2::uuid
        order by created_at desc limit $3
      `, [tenant.id, conversation.id, HISTORY_LIMIT])).rows.reverse();

      return { contact, channel, conversation, history, sequencesStopped: stoppedMessages.rows.length };
    });

    let aiResult = { replied: false };
    if (prepared.conversation.ai_enabled && this.ai?.enabled) {
      try {
        aiResult = await this.runAiTurn({ tenant, ...prepared });
      } catch (error) {
        this.log("error", "conversation_ai_failed", { message: error.message, conversationId: prepared.conversation.id });
        await this.flagForHuman(tenant.id, prepared.conversation.id, prepared.contact.id, prepared.channel, "ai_error");
      }
    } else if (!this.ai?.enabled) {
      await this.flagForHuman(tenant.id, prepared.conversation.id, prepared.contact.id, prepared.channel, "ai_disabled");
    }

    return {
      handled: true,
      conversationId: prepared.conversation.id,
      contactId: prepared.contact.id,
      channel: prepared.channel,
      sequencesStopped: prepared.sequencesStopped,
      aiReplied: aiResult.replied,
      aiAction: aiResult.action || null
    };
  }

  async flagForHuman(tenantId, conversationId, contactId, channel, reason) {
    await this.db.query(`
      update conversations set status = 'human_needed', updated_at = now() where id = $1::uuid
    `, [conversationId]);
    await this.db.query(`
      insert into contact_notes (tenant_id, contact_id, author, kind, body, metadata)
      values ($1::uuid, $2::uuid, 'system', 'status', $3, $4::jsonb)
    `, [tenantId, contactId, `Conversation needs a human (${reason})`, JSON.stringify({ conversationId })]);
  }

  async queueOutbound(tenant, { contact, conversation, channel, bodyText, aiGenerated = true, templateId = null }) {
    await this.db.query(`
      insert into messages (tenant_id, contact_id, conversation_id, channel, direction, body, template_id,
                            delivery_status, scheduled_for, ai_generated, created_at)
      values ($1::uuid, $2::uuid, $3::uuid, $4, 'outbound', $5, $6, 'queued', now(), $7, now())
    `, [tenant.id, contact.id, conversation.id, channel, bodyText, templateId, aiGenerated]);
    await this.db.query(`
      update conversations set last_message_at = now(), last_direction = 'outbound', updated_at = now()
      where id = $1::uuid
    `, [conversation.id]);
  }

  async runAiTurn({ tenant, contact, channel, conversation, history }) {
    const now = this.now();
    const persona = salonPersona(tenant);
    const system = [
      persona,
      `\nCurrent date/time: ${now.toISOString()} (${tenant.timezone || "Europe/Zurich"}).`,
      `You are handling an inbound ${channel} message thread with ${contact.first_name || "a customer"}.`,
      contact.total_bookings ? `They are a returning customer (${contact.total_bookings} past bookings).` : "They may be a new customer.",
      "Your job: answer their question, and if they want an appointment, use check_availability then book_appointment.",
      "Ask for at most one missing detail at a time. Confirm the exact slot before booking.",
      "When you have replied and nothing else is needed, just answer normally (no tool).",
      "Use escalate_to_human for complaints, refunds, medical/allergy questions, or anything off-menu."
    ].join(" ");

    const messages = history.map((m) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.body
    }));
    // Collapse to alternating roles the API accepts: ensure it starts with user.
    while (messages.length && messages[0].role !== "user") messages.shift();
    if (!messages.length) return { replied: false };

    let action = null;
    let finalText = "";

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      const result = await this.ai.complete({ system, messages, tools: CONVERSATION_TOOLS, maxTokens: 700, temperature: 0.3 });
      if (result.text) finalText = result.text;

      if (!result.toolUses.length) break;

      messages.push({ role: "assistant", content: result.raw.content });
      const toolResults = [];
      for (const call of result.toolUses) {
        const output = await this.executeTool(tenant, contact, channel, call);
        if (output.action) action = output.action;
        toolResults.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(output.result) });
      }
      messages.push({ role: "user", content: toolResults });
      if (action === "booked" || action === "escalated" || action === "closed") {
        const wrap = await this.ai.complete({ system, messages, maxTokens: 300, temperature: 0.3 });
        if (wrap.text) finalText = wrap.text;
        break;
      }
    }

    if (action === "escalated") {
      await this.flagForHuman(tenant.id, conversation.id, contact.id, channel, "ai_escalation");
    } else if (action === "closed") {
      await this.db.query("update conversations set status = 'closed', updated_at = now() where id = $1::uuid", [conversation.id]);
    }

    if (finalText) {
      await this.queueOutbound(tenant, { contact, conversation, channel, bodyText: finalText });
      return { replied: true, action };
    }
    return { replied: false, action };
  }

  async executeTool(tenant, contact, channel, call) {
    const args = call.input || {};
    try {
      if (call.name === "check_availability") {
        const res = await this.booking.checkAvailability(tenant.id, {
          startTime: args.startTime,
          serviceId: args.service
        });
        return { result: res };
      }
      if (call.name === "book_appointment") {
        const res = await this.booking.bookAppointment(tenant.id, {
          startTime: args.startTime,
          serviceId: args.service,
          customerName: args.customerName || contact.first_name || "Guest",
          customerPhone: contact.phone_e164 || `sub:${contact.manychat_subscriber_id || contact.id}`,
          customerEmail: contact.email || undefined,
          notes: args.notes,
          bookedVia: "ai_chat"
        });
        return { result: res, action: res.status === "booked" ? "booked" : null };
      }
      if (call.name === "escalate_to_human") {
        return { result: { ok: true, note: "A colleague has been notified." }, action: "escalated" };
      }
      if (call.name === "close_conversation") {
        return { result: { ok: true }, action: "closed" };
      }
      return { result: { error: `Unknown tool ${call.name}` } };
    } catch (error) {
      this.log("error", "conversation_tool_failed", { tool: call.name, message: error.message });
      return { result: { error: "That action failed. Offer to have a colleague follow up." } };
    }
  }
}
