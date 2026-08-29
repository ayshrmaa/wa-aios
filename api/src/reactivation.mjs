// Lead / customer reactivation. The salon picks a segment of quiet past
// customers ("no booking in 90 days", "at least 2 past visits", ...), the
// service snapshots the matching contacts, and on launch it generates a
// personalised opener for each and drips them out through the normal message
// dispatcher. A reply or a booking stops that contact's campaign messages
// (handled in conversations.mjs / booking-service.mjs via sequence_runs).

import { renderMessageTemplate } from "./messaging-templates.mjs";
import { generateReactivationMessage } from "./ai.mjs";
import { isQuietTime, nextQuietEnd } from "./time.mjs";
import { firstNameOf } from "./leads.mjs";

const clientError = (message) => Object.assign(new Error(message), { statusCode: 400 });

const DEFAULT_CRITERIA = { inactiveDays: 90, minCompletedBookings: 1, service: null, lifecycleStage: null };

function normaliseCriteria(input = {}) {
  return {
    inactiveDays: Math.max(1, Math.min(3650, Number(input.inactiveDays ?? DEFAULT_CRITERIA.inactiveDays))),
    minCompletedBookings: Math.max(0, Math.min(50, Number(input.minCompletedBookings ?? DEFAULT_CRITERIA.minCompletedBookings))),
    service: input.service ? String(input.service).trim() : null,
    lifecycleStage: ["active", "inactive", "vip", "lead"].includes(input.lifecycleStage) ? input.lifecycleStage : null,
    minLifetimeValueChf: input.minLifetimeValueChf != null ? Math.max(0, Number(input.minLifetimeValueChf)) : null
  };
}

function matchQuery(criteria) {
  return {
    text: `
      select c.id::text, c.first_name, c.last_name, c.email, c.phone_e164, c.manychat_subscriber_id,
             c.last_booked_at, c.completed_bookings, c.lifetime_value_chf::float8 as lifetime_value_chf,
             c.lifecycle_stage,
             (select a.service from appointments a
              where a.contact_id = c.id and a.status = 'completed' order by a.ends_at desc limit 1) as last_service
      from contacts c
      where c.tenant_id = $1::uuid
        and c.marketing_opt_out = false
        and c.completed_bookings >= $2
        and (c.last_booked_at is null or c.last_booked_at <= now() - make_interval(days => $3::int))
        and coalesce(c.email, c.phone_e164, c.manychat_subscriber_id) is not null
        and not exists (
          select 1 from appointments a
          where a.contact_id = c.id and a.status in ('booked', 'reserved') and a.starts_at > now()
        )
        and not exists (
          select 1 from reactivation_targets t
          join reactivation_campaigns rc on rc.id = t.campaign_id
          where t.contact_id = c.id and rc.status in ('draft', 'active', 'paused')
        )
        and ($4::text is null or c.lifecycle_stage = $4)
        and ($5::numeric is null or c.lifetime_value_chf >= $5)
        and ($6::text is null or exists (
          select 1 from appointments a where a.contact_id = c.id and a.service ilike '%' || $6 || '%'
        ))
      order by c.last_booked_at asc nulls last`,
    params: (tenantId) => [
      tenantId, criteria.minCompletedBookings, criteria.inactiveDays,
      criteria.lifecycleStage, criteria.minLifetimeValueChf, criteria.service
    ]
  };
}

export class ReactivationService {
  constructor({ db, ai, tenantLoader, logger = console, now = () => new Date() }) {
    this.db = db;
    this.ai = ai;
    this.tenantLoader = tenantLoader;
    this.logger = logger;
    this.now = now;
  }

  log(level, event, details = {}) {
    const sink = this.logger?.[level] ?? this.logger?.log;
    if (sink) sink.call(this.logger, JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...details }));
  }

  async preview(tenantId, body = {}) {
    const tenant = await this.tenantLoader(tenantId);
    const criteria = normaliseCriteria(body.criteria ?? body);
    const q = matchQuery(criteria);
    const rows = (await this.db.query(q.text, q.params(tenant.id))).rows;
    return {
      criteria,
      total: rows.length,
      estimatedValueChf: Math.round(rows.reduce((sum, r) => sum + (r.lifetime_value_chf || 0), 0)),
      sample: rows.slice(0, 12).map((r) => ({
        contactId: r.id,
        name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Guest",
        lastService: r.last_service,
        lastBookedAt: r.last_booked_at,
        completedBookings: r.completed_bookings,
        lifetimeValueChf: r.lifetime_value_chf,
        reachableBy: r.email ? "email" : r.phone_e164 ? "whatsapp" : "instagram"
      }))
    };
  }

  async listCampaigns(tenantId) {
    const rows = (await this.db.query(`
      select id::text, name, status, channel, criteria, offer, goal, message_style, daily_send_cap,
             total_targeted, messages_sent, responses, bookings, launched_at, completed_at, created_at, updated_at
      from reactivation_campaigns where tenant_id = $1::uuid order by created_at desc
    `, [tenantId])).rows;
    return { campaigns: rows };
  }

  async getCampaign(tenantId, campaignId) {
    const campaign = (await this.db.query(`
      select id::text, name, status, channel, criteria, offer, goal, message_style, daily_send_cap,
             total_targeted, messages_sent, responses, bookings, launched_at, completed_at, created_at
      from reactivation_campaigns where tenant_id = $1::uuid and id = $2::uuid
    `, [tenantId, campaignId])).rows[0];
    if (!campaign) return null;
    const targets = (await this.db.query(`
      select t.id::text, t.status, t.personalised_body, t.scheduled_for, t.sent_at, t.responded_at,
             t.booked_appointment_id::text, c.first_name, c.last_name, c.email, c.phone_e164
      from reactivation_targets t join contacts c on c.id = t.contact_id
      where t.tenant_id = $1::uuid and t.campaign_id = $2::uuid
      order by t.scheduled_for nulls last, t.created_at
    `, [tenantId, campaignId])).rows;
    return { campaign, targets };
  }

  async createCampaign(tenantId, body) {
    const tenant = await this.tenantLoader(tenantId);
    if (!body.name) throw clientError("A campaign needs a name.");
    const criteria = normaliseCriteria(body.criteria ?? {});
    const channel = ["email", "whatsapp", "sms", "instagram"].includes(body.channel) ? body.channel : "email";
    const q = matchQuery(criteria);

    return this.db.transaction(async (tx) => {
      const campaign = (await tx.query(`
        insert into reactivation_campaigns (tenant_id, name, status, channel, criteria, offer, goal, message_style, daily_send_cap, created_by)
        values ($1::uuid, $2, 'draft', $3, $4::jsonb, $5, $6, $7, $8, $9)
        returning id::text
      `, [tenant.id, String(body.name).slice(0, 120), channel, JSON.stringify(criteria),
          body.offer ? String(body.offer).slice(0, 300) : null,
          body.goal ? String(body.goal).slice(0, 300) : null,
          ["warm", "brief", "premium"].includes(body.messageStyle) ? body.messageStyle : "warm",
          Math.max(1, Math.min(500, Number(body.dailySendCap ?? 40))),
          body.createdBy || "dashboard"])).rows[0];

      const matches = (await tx.query(q.text, q.params(tenant.id))).rows;
      for (const contact of matches) {
        const targetChannel = channel === "email" && !contact.email ? (contact.phone_e164 ? "whatsapp" : "instagram") : channel;
        await tx.query(`
          insert into reactivation_targets (tenant_id, campaign_id, contact_id, status, channel, last_context)
          values ($1::uuid, $2::uuid, $3::uuid, 'pending', $4, $5::jsonb)
          on conflict (campaign_id, contact_id) do nothing
        `, [tenant.id, campaign.id, contact.id, targetChannel,
            JSON.stringify({ lastService: contact.last_service, lastBookedAt: contact.last_booked_at })]);
      }
      await tx.query("update reactivation_campaigns set total_targeted = $2, updated_at = now() where id = $1::uuid",
        [campaign.id, matches.length]);

      return { campaignId: campaign.id, status: "draft", totalTargeted: matches.length };
    });
  }

  async launchCampaign(tenantId, body) {
    const tenant = await this.tenantLoader(tenantId);
    const campaignId = body.campaignId;
    const campaign = (await this.db.query(
      "select * from reactivation_campaigns where tenant_id = $1::uuid and id = $2::uuid", [tenant.id, campaignId]
    )).rows[0];
    if (!campaign) throw Object.assign(new Error("Campaign not found."), { statusCode: 404 });
    if (!["draft", "paused"].includes(campaign.status)) throw clientError(`Campaign is ${campaign.status}.`);

    const criteria = typeof campaign.criteria === "string" ? JSON.parse(campaign.criteria) : campaign.criteria;
    const targets = (await this.db.query(`
      select t.id::text, t.channel, t.contact_id::text, t.last_context,
             c.first_name, c.last_name, c.email, c.phone_e164, c.manychat_subscriber_id, c.last_booked_at,
             (select a.service from appointments a where a.contact_id = c.id and a.status = 'completed' order by a.ends_at desc limit 1) as last_service
      from reactivation_targets t join contacts c on c.id = t.contact_id
      where t.tenant_id = $1::uuid and t.campaign_id = $2::uuid and t.status = 'pending'
      order by c.last_booked_at asc nulls last
    `, [tenant.id, campaignId])).rows;

    const cap = Math.max(1, campaign.daily_send_cap);
    const startAt = this.now();
    let scheduled = 0;

    for (const [index, target] of targets.entries()) {
      const dayOffset = Math.floor(index / cap);
      const withinDay = index % cap;
      const baseTime = new Date(startAt.getTime() + dayOffset * 86_400_000 + withinDay * 90_000);
      const fireAt = isQuietTime(baseTime, tenant.timezone, tenant.quiet_hours)
        ? nextQuietEnd(baseTime, tenant.timezone, tenant.quiet_hours)
        : baseTime;

      const fallback = renderMessageTemplate({
        tenant, templateId: "reactivation_intro",
        contact: { first_name: firstNameOf([target.first_name, target.last_name].filter(Boolean).join(" ")) },
        lead: { lastService: target.last_service, offer: campaign.offer }
      }).body;

      let personalised = fallback;
      try {
        personalised = await generateReactivationMessage({
          ai: this.ai, tenant, campaign,
          contact: {
            first_name: target.first_name, last_service: target.last_service, last_booked_at: target.last_booked_at
          },
          fallbackBody: fallback
        });
      } catch (error) {
        this.log("warn", "reactivation_generate_failed", { message: error.message, targetId: target.id });
      }

      await this.db.transaction(async (tx) => {
        const message = (await tx.query(`
          insert into messages (tenant_id, contact_id, channel, direction, body, template_id, campaign_id,
                                delivery_status, scheduled_for, ai_generated)
          values ($1::uuid, $2::uuid, $3, 'outbound', $4, 'reactivation_intro', $5::uuid, 'queued', $6::timestamptz, $7)
          returning id::text
        `, [tenant.id, target.contact_id, target.channel, personalised, campaignId, fireAt.toISOString(), Boolean(this.ai?.enabled)])).rows[0];

        await tx.query(`
          update reactivation_targets set status = 'queued', personalised_body = $2, message_id = $3::uuid,
                 scheduled_for = $4::timestamptz, updated_at = now()
          where id = $1::uuid
        `, [target.id, personalised, message.id, fireAt.toISOString()]);

        await tx.query(`
          insert into sequence_runs (tenant_id, contact_id, sequence_type, status, current_step, next_fire_at, metadata)
          values ($1::uuid, $2::uuid, 'reactivation', 'active', 'reactivation_intro', $3::timestamptz, $4::jsonb)
        `, [tenant.id, target.contact_id, fireAt.toISOString(), JSON.stringify({ campaignId, targetId: target.id })]);

        await tx.query(`
          update contacts set lifecycle_stage = case when lifecycle_stage = 'inactive' then 'inactive' else lifecycle_stage end
          where id = $1::uuid
        `, [target.contact_id]);

        await tx.query(`
          insert into contact_notes (tenant_id, contact_id, author, kind, body, metadata)
          values ($1::uuid, $2::uuid, 'system', 'reactivation', $3, $4::jsonb)
        `, [tenant.id, target.contact_id, `Added to reactivation campaign "${campaign.name}"`, JSON.stringify({ campaignId })]);
      });
      scheduled += 1;
    }

    await this.db.query(`
      update reactivation_campaigns set status = 'active', launched_at = coalesce(launched_at, now()), updated_at = now()
      where id = $1::uuid
    `, [campaignId]);

    return { launched: true, campaignId, messagesScheduled: scheduled };
  }

  async setStatus(tenantId, body) {
    const status = String(body.status ?? "").toLowerCase();
    if (!["paused", "active", "archived", "completed"].includes(status)) throw clientError("Invalid status.");
    const campaign = (await this.db.query(
      "select * from reactivation_campaigns where tenant_id = $1::uuid and id = $2::uuid", [tenantId, body.campaignId]
    )).rows[0];
    if (!campaign) throw Object.assign(new Error("Campaign not found."), { statusCode: 404 });

    if (status === "paused") {
      await this.db.query(`
        update messages set delivery_status = 'failed'
        where tenant_id = $1::uuid and campaign_id = $2::uuid and delivery_status = 'queued'
      `, [tenantId, body.campaignId]);
      await this.db.query(`
        update reactivation_targets set status = 'skipped', updated_at = now()
        where tenant_id = $1::uuid and campaign_id = $2::uuid and status = 'queued'
      `, [tenantId, body.campaignId]);
    }
    await this.db.query("update reactivation_campaigns set status = $2, updated_at = now() where id = $1::uuid",
      [body.campaignId, status]);
    return { updated: true, campaignId: body.campaignId, status };
  }

  // Reconcile target + campaign counters from message delivery, complete
  // campaigns whose sends have all resolved. Called from the messaging cycle.
  async tick() {
    await this.db.query(`
      update reactivation_targets t set status = 'sent', sent_at = coalesce(t.sent_at, m.sent_at, now()), updated_at = now()
      from messages m
      where m.id = t.message_id and t.status = 'queued' and m.delivery_status in ('sent', 'stubbed', 'delivered')
    `);
    await this.db.query(`
      update reactivation_targets t set status = 'failed', updated_at = now()
      from messages m
      where m.id = t.message_id and t.status = 'queued' and m.delivery_status = 'failed'
        and not exists (select 1 from reactivation_campaigns rc where rc.id = t.campaign_id and rc.status = 'paused')
    `);
    await this.db.query(`
      update reactivation_campaigns c set
        messages_sent = (select count(*) from reactivation_targets t where t.campaign_id = c.id and t.status in ('sent', 'responded', 'booked')),
        bookings = (select count(*) from reactivation_targets t where t.campaign_id = c.id and t.status = 'booked'),
        updated_at = now()
      where c.status = 'active'
    `);
    await this.db.query(`
      update reactivation_campaigns c set status = 'completed', completed_at = now(), updated_at = now()
      where c.status = 'active' and c.total_targeted > 0
        and not exists (select 1 from reactivation_targets t where t.campaign_id = c.id and t.status in ('pending', 'queued'))
    `);
  }
}
