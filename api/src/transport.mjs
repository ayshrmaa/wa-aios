export class TransportConfigurationError extends Error {}

function log(logger, event, details = {}) {
  const sink = logger?.info ?? logger?.log;
  if (!sink) return;
  sink.call(logger, JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    event,
    ...details
  }));
}

function normaliseProvider(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[-\s]/g, "_");
}

function providerForChannel(channel, tenant, env) {
  const config = tenant.messaging_config ?? {};
  const fromTenant = config.channels?.[channel]?.provider
    ?? config.providers?.[channel]
    ?? config[`${channel}Provider`];
  const fromEnvironment = env[`MESSAGE_TRANSPORT_${String(channel).toUpperCase()}`]
    ?? env.MESSAGING_TRANSPORT_PROVIDER;
  const selected = normaliseProvider(fromTenant ?? fromEnvironment ?? (config.mode === "stub" ? "null" : "null"));
  if (["", "null", "stub", "none"].includes(selected)) return "null";
  if (selected === "resend") return "resend";
  if (["whatsapp_cloud", "whatsappcloud", "meta_whatsapp"].includes(selected)) return "whatsapp_cloud";
  throw new TransportConfigurationError(
    `Unknown message transport ${selected || "(empty)"} for ${channel}. Expected null, resend, or whatsapp_cloud.`
  );
}

export class NullTransport {
  constructor({ logger = console } = {}) {
    this.provider = "null";
    this.logger = logger;
  }

  async send({ message, recipient, rendered }) {
    log(this.logger, "message_would_send", {
      messageId: message.id,
      channel: message.channel,
      to: recipient,
      templateId: message.template_id,
      subject: rendered.subject || null,
      body: rendered.body
    });
    return { status: "stubbed", provider: this.provider };
  }
}

export class ResendEmail {
  constructor({ apiKey, from, fetchImpl = fetch } = {}) {
    if (!apiKey) {
      throw new TransportConfigurationError(
        "Email transport is set to Resend, but RESEND_API_KEY is missing. No fallback transport was used."
      );
    }
    if (!from) {
      throw new TransportConfigurationError(
        "Email transport is set to Resend, but MAIL_FROM is missing. No fallback transport was used."
      );
    }
    this.provider = "resend";
    this.apiKey = apiKey;
    this.from = from;
    this.fetchImpl = fetchImpl;
  }

  async send({ message, recipient, rendered, tenant }) {
    if (!recipient) throw new Error(`Message ${message.id} has no email recipient.`);
    const senderName = tenant.messaging_config?.senderName || tenant.name;
    const from = senderName && !this.from.includes("<") ? `${senderName} <${this.from}>` : this.from;
    const response = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `wa-aios-message-${message.id}`
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject: rendered.subject || "Message from your salon",
        text: rendered.body
      })
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Resend API ${response.status}: ${detail || response.statusText}`);
    }
    const result = await response.json();
    return { status: "sent", provider: this.provider, providerMessageId: result.id ?? null };
  }
}

export class WhatsAppCloud {
  constructor({ token, phoneNumberId, apiVersion = "v20.0", fetchImpl = fetch } = {}) {
    if (!token) {
      throw new TransportConfigurationError(
        "WhatsApp Cloud transport is selected, but WHATSAPP_TOKEN is missing. No fallback transport was used."
      );
    }
    if (!phoneNumberId) {
      throw new TransportConfigurationError(
        "WhatsApp Cloud transport is selected, but WHATSAPP_PHONE_NUMBER_ID is missing. No fallback transport was used."
      );
    }
    this.provider = "whatsapp_cloud";
    this.token = token;
    this.phoneNumberId = phoneNumberId;
    this.apiVersion = apiVersion;
    this.fetchImpl = fetchImpl;
  }

  async send({ message, recipient, rendered }) {
    if (!recipient) throw new Error(`Message ${message.id} has no WhatsApp recipient.`);
    const components = rendered.whatsapp.bodyParameters.length
      ? [{
          type: "body",
          parameters: rendered.whatsapp.bodyParameters.map((text) => ({ type: "text", text }))
        }]
      : [];
    const response = await this.fetchImpl(
      `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient.replace(/^\+/, ""),
          type: "template",
          template: {
            name: rendered.whatsapp.name,
            language: { code: rendered.whatsapp.languageCode },
            components
          }
        })
      }
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `WhatsApp Cloud API ${response.status}: ${detail || response.statusText}. `
        + "The selected template must be approved in Meta before it can send."
      );
    }
    const result = await response.json();
    return {
      status: "sent",
      provider: this.provider,
      providerMessageId: result.messages?.[0]?.id ?? null
    };
  }
}

export class ChannelTransport {
  constructor({ env = process.env, logger = console, fetchImpl = fetch } = {}) {
    this.env = env;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.provider = "router";
  }

  forMessage(message, tenant) {
    const provider = providerForChannel(message.channel, tenant, this.env);
    if (provider === "null") return new NullTransport({ logger: this.logger });
    if (provider === "resend") {
      if (message.channel !== "email") {
        throw new TransportConfigurationError("Resend can only be selected for the email channel.");
      }
      return new ResendEmail({
        apiKey: this.env.RESEND_API_KEY,
        from: this.env.MAIL_FROM,
        fetchImpl: this.fetchImpl
      });
    }
    if (provider === "whatsapp_cloud") {
      if (message.channel !== "whatsapp") {
        throw new TransportConfigurationError("WhatsApp Cloud can only be selected for the whatsapp channel.");
      }
      return new WhatsAppCloud({
        token: this.env.WHATSAPP_TOKEN,
        phoneNumberId: this.env.WHATSAPP_PHONE_NUMBER_ID,
        apiVersion: this.env.WHATSAPP_GRAPH_API_VERSION || "v20.0",
        fetchImpl: this.fetchImpl
      });
    }
    throw new TransportConfigurationError(`No transport is available for ${message.channel}.`);
  }

  async send(input) {
    return this.forMessage(input.message, input.tenant).send(input);
  }
}

export function createTransport(options = {}) {
  return new ChannelTransport(options);
}
