// Anthropic wrapper. The whole AI surface is optional: without ANTHROPIC_API_KEY
// `enabled` is false and callers fall back to deterministic templates / human
// routing. Nothing in the booking or messaging core depends on this module.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

function log(logger, level, event, details = {}) {
  const sink = logger?.[level] ?? logger?.log;
  if (!sink) return;
  sink.call(logger, JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...details }));
}

export class AiClient {
  constructor({
    apiKey = process.env.ANTHROPIC_API_KEY,
    model = process.env.AIOS_AI_MODEL || "claude-sonnet-5",
    fetchImpl = fetch,
    logger = console,
    timeoutMs = 30_000
  } = {}) {
    this.apiKey = apiKey || "";
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.timeoutMs = timeoutMs;
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  /**
   * @param {{ system?: string, messages: Array<{role:string,content:any}>, maxTokens?: number, temperature?: number, tools?: any[] }} input
   * @returns {Promise<{ text: string, toolUses: Array<{id:string,name:string,input:any}>, stopReason: string, raw: any }>}
   */
  async complete({ system, messages, maxTokens = 700, temperature = 0.4, tools } = {}) {
    if (!this.enabled) throw new Error("AiClient is disabled: ANTHROPIC_API_KEY is not set.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(ANTHROPIC_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: maxTokens,
          temperature,
          ...(system ? { system } : {}),
          ...(tools?.length ? { tools } : {}),
          messages
        })
      });
      const text = await response.text();
      if (!response.ok) {
        log(this.logger, "error", "ai_request_failed", { status: response.status, body: text.slice(0, 400) });
        throw new Error(`Anthropic ${response.status}: ${text.slice(0, 300)}`);
      }
      const raw = JSON.parse(text);
      const blocks = Array.isArray(raw.content) ? raw.content : [];
      return {
        text: blocks.filter((b) => b.type === "text").map((b) => b.text).join("").trim(),
        toolUses: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input })),
        stopReason: raw.stop_reason,
        raw
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createAiClient(options = {}) {
  return new AiClient(options);
}

/** Short, on-brand salon persona shared by every AI touchpoint. */
export function salonPersona(tenant) {
  const services = (tenant.services ?? [])
    .map((s) => `${s.name}${s.priceChf ? ` (CHF ${s.priceChf}, ${s.durationMinutes ?? 60} min)` : ""}`)
    .join("; ");
  const locale = tenant.locale || "de-CH";
  return [
    `You are the front-desk assistant for ${tenant.name}, a hair & beauty salon`,
    tenant.contact_config?.address ? ` at ${tenant.contact_config.address}` : "",
    `. Timezone ${tenant.timezone || "Europe/Zurich"}, currency ${tenant.currency || "CHF"}.`,
    locale.startsWith("de") ? " Reply in natural Swiss-standard German unless the customer writes in another language." : " Reply in the customer's language.",
    " Warm, concise, human — 1-3 sentences, no corporate filler, never use emoji more than once.",
    services ? ` Services: ${services}.` : "",
    tenant.contact_config?.phone ? ` Salon phone: ${tenant.contact_config.phone}.` : "",
    " Never invent prices, availability, or policies. If unsure, offer to have a colleague follow up."
  ].join("");
}

/**
 * Personalised reactivation opener. Uses the model when available, otherwise a
 * varied deterministic line. Always returns a plain string.
 */
export async function generateReactivationMessage({ ai, tenant, contact, campaign, fallbackBody }) {
  if (!ai?.enabled) return fallbackBody;
  const lastService = contact.last_service || null;
  const monthsAway = contact.last_booked_at
    ? Math.max(1, Math.round((Date.now() - new Date(contact.last_booked_at).getTime()) / (30 * 86_400_000)))
    : null;
  try {
    const { text } = await ai.complete({
      system: salonPersona(tenant)
        + " You are writing ONE outbound re-engagement message to a past customer who hasn't booked in a while."
        + " Goal: make them feel remembered and invite them back. No hard sell. One short paragraph, no subject line, no signature.",
      temperature: 0.7,
      maxTokens: 260,
      messages: [{
        role: "user",
        content: [
          `Customer first name: ${contact.first_name || "there"}`,
          lastService ? `Last service: ${lastService}` : "Last service: unknown",
          monthsAway ? `Approx months since last visit: ${monthsAway}` : "",
          campaign?.offer ? `Incentive you may mention naturally: ${campaign.offer}` : "No specific incentive.",
          campaign?.goal ? `Campaign intent: ${campaign.goal}` : "",
          `Channel: ${campaign?.channel || "email"} (keep it appropriate for that channel).`
        ].filter(Boolean).join("\n")
      }]
    });
    return text || fallbackBody;
  } catch {
    return fallbackBody;
  }
}
