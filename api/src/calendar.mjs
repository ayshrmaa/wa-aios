import { createSign, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

export class CalendarConfigurationError extends Error {}

export class LocalCalendar {
  constructor(db) {
    this.db = db;
    this.provider = "local";
  }

  client(context) {
    return context?.db ?? this.db;
  }

  async isAvailable({ tenantId, calendarId, startTime, endTime, excludeEventId }, context) {
    const result = await this.client(context).query(`
      select count(*)::int as conflicts
      from local_calendar_events
      where tenant_id = $1::uuid
        and calendar_id = $2
        and ($5::text is null or external_id <> $5)
        and tstzrange(starts_at, ends_at, '[)') && tstzrange($3::timestamptz, $4::timestamptz, '[)')
    `, [tenantId, calendarId, startTime, endTime, excludeEventId ?? null]);
    return result.rows[0].conflicts === 0;
  }

  async createEvent(event, context) {
    const externalId = `local-${randomUUID()}`;
    await this.client(context).query(`
      insert into local_calendar_events (
        tenant_id, external_id, calendar_id, starts_at, ends_at, summary, description
      ) values ($1::uuid, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7)
    `, [
      event.tenantId,
      externalId,
      event.calendarId,
      event.startTime,
      event.endTime,
      event.summary,
      event.description ?? null
    ]);
    return { id: externalId };
  }

  async updateEvent(event, context) {
    const result = await this.client(context).query(`
      update local_calendar_events
      set starts_at = $4::timestamptz,
          ends_at = $5::timestamptz,
          summary = $6,
          description = $7
      where tenant_id = $1::uuid and calendar_id = $2 and external_id = $3
      returning external_id
    `, [
      event.tenantId,
      event.calendarId,
      event.eventId,
      event.startTime,
      event.endTime,
      event.summary,
      event.description ?? null
    ]);
    if (!result.rows.length) throw new Error(`Local calendar event ${event.eventId} was not found.`);
    return { id: result.rows[0].external_id };
  }

  async deleteEvent({ tenantId, calendarId, eventId }, context) {
    const result = await this.client(context).query(`
      delete from local_calendar_events
      where tenant_id = $1::uuid and calendar_id = $2 and external_id = $3
      returning external_id
    `, [tenantId, calendarId, eventId]);
    if (!result.rows.length) throw new Error(`Local calendar event ${eventId} was not found.`);
  }
}

export class GoogleAuth {
  static SCOPE = "https://www.googleapis.com/auth/calendar";

  static describe(env = process.env) {
    if (env.GOOGLE_OAUTH_REFRESH_TOKEN) return "oauth_refresh";
    if (env.GOOGLE_SERVICE_ACCOUNT_JSON) return "service_account";
    if (env.GOOGLE_CALENDAR_ACCESS_TOKEN) return "static_token";
    return null;
  }

  constructor({ env = process.env, fetchImpl = fetch, now = () => Date.now(), logger = console } = {}) {
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.logger = logger;
    this.cached = null;
    this.tokenUri = env.GOOGLE_TOKEN_URI || "https://oauth2.googleapis.com/token";
    this.mode = GoogleAuth.describe(env);

    if (this.mode === "oauth_refresh") {
      const missing = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"].filter((key) => !env[key]);
      if (missing.length) {
        throw new CalendarConfigurationError(
          `GOOGLE_OAUTH_REFRESH_TOKEN is set but ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing.`
        );
      }
      this.clientId = env.GOOGLE_OAUTH_CLIENT_ID;
      this.clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
      this.refreshToken = env.GOOGLE_OAUTH_REFRESH_TOKEN;
    } else if (this.mode === "service_account") {
      const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON.trim();
      let account;
      try {
        account = JSON.parse(raw.startsWith("{") ? raw : readFileSync(raw, "utf8"));
      } catch (error) {
        throw new CalendarConfigurationError(
          `GOOGLE_SERVICE_ACCOUNT_JSON must be inline JSON or a path to the service-account key file (${error.message}).`
        );
      }
      if (!account.client_email || !account.private_key) {
        throw new CalendarConfigurationError("Service account JSON is missing client_email or private_key.");
      }
      this.account = account;
      this.subject = env.GOOGLE_IMPERSONATE_EMAIL || null;
      if (account.token_uri) this.tokenUri = account.token_uri;
    } else if (this.mode === "static_token") {
      this.logger.warn?.(
        "[calendar] GOOGLE_CALENDAR_ACCESS_TOKEN is a raw access token. It expires in about an hour and is for local testing only. Use GOOGLE_OAUTH_REFRESH_TOKEN or GOOGLE_SERVICE_ACCOUNT_JSON in production."
      );
      this.cached = { token: env.GOOGLE_CALENDAR_ACCESS_TOKEN, expiresAt: Number.POSITIVE_INFINITY };
    } else {
      throw new CalendarConfigurationError(
        "CALENDAR_PROVIDER=google needs credentials. Set ONE of: " +
          "GOOGLE_OAUTH_REFRESH_TOKEN (+ GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET), " +
          "GOOGLE_SERVICE_ACCOUNT_JSON (path or inline JSON, optional GOOGLE_IMPERSONATE_EMAIL), " +
          "or GOOGLE_CALENDAR_ACCESS_TOKEN (dev only, expires hourly). No local fallback was used."
      );
    }
  }

  async token({ force = false } = {}) {
    if (this.mode === "static_token") return this.cached.token;
    if (!force && this.cached && this.cached.expiresAt - this.now() > 60_000) return this.cached.token;

    const body =
      this.mode === "oauth_refresh"
        ? new URLSearchParams({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: this.refreshToken,
            grant_type: "refresh_token"
          })
        : new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: this.signAssertion()
          });

    const response = await this.fetchImpl(this.tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Google token endpoint ${response.status}: ${detail || response.statusText}`);
    }
    const json = await response.json();
    if (!json.access_token) throw new Error("Google token endpoint returned no access_token.");
    this.cached = {
      token: json.access_token,
      expiresAt: this.now() + Number(json.expires_in ?? 3600) * 1000
    };
    return this.cached.token;
  }

  signAssertion() {
    const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
    const iat = Math.floor(this.now() / 1000);
    const claims = {
      iss: this.account.client_email,
      scope: GoogleAuth.SCOPE,
      aud: this.tokenUri,
      iat,
      exp: iat + 3600
    };
    if (this.subject) claims.sub = this.subject;
    const input = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}`;
    const signature = createSign("RSA-SHA256").update(input).sign(this.account.private_key).toString("base64url");
    return `${input}.${signature}`;
  }
}

export class GoogleCalendar {
  constructor({ auth, apiBase = "https://www.googleapis.com/calendar/v3", fetchImpl = fetch }) {
    if (!auth) throw new CalendarConfigurationError("GoogleCalendar requires a GoogleAuth instance.");
    this.provider = "google";
    this.auth = auth;
    this.fetchImpl = fetchImpl;
    this.apiBase = (apiBase || "https://www.googleapis.com/calendar/v3").replace(/\/$/, "");
  }

  async request(pathname, options = {}, attempt = 0) {
    const token = await this.auth.token({ force: attempt > 0 });
    const response = await this.fetchImpl(`${this.apiBase}${pathname}`, {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...options.headers
      }
    });
    if (response.status === 401 && attempt === 0) return this.request(pathname, options, 1);
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Google Calendar API ${response.status}: ${detail || response.statusText}`);
    }
    return response.status === 204 ? null : response.json();
  }

  async isAvailable({ calendarId, startTime, endTime, excludeEventId }) {
    const result = await this.request("/freeBusy", {
      method: "POST",
      body: JSON.stringify({
        timeMin: new Date(startTime).toISOString(),
        timeMax: new Date(endTime).toISOString(),
        items: [{ id: calendarId }]
      })
    });
    const busy = result.calendars?.[calendarId]?.busy ?? [];
    if (!excludeEventId) return busy.length === 0;

    // FreeBusy cannot identify the event that owns a busy range. During a
    // reschedule, query concrete events so the existing appointment can be ignored.
    const params = new URLSearchParams({
      timeMin: new Date(startTime).toISOString(),
      timeMax: new Date(endTime).toISOString(),
      singleEvents: "true",
      showDeleted: "false"
    });
    const events = await this.request(
      `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
    );
    return (events.items ?? []).every((event) => event.id === excludeEventId);
  }

  async createEvent(event) {
    const result = await this.request(`/calendars/${encodeURIComponent(event.calendarId)}/events`, {
      method: "POST",
      body: JSON.stringify({
        summary: event.summary,
        description: event.description,
        start: { dateTime: new Date(event.startTime).toISOString() },
        end: { dateTime: new Date(event.endTime).toISOString() }
      })
    });
    return { id: result.id };
  }

  async updateEvent(event) {
    const result = await this.request(
      `/calendars/${encodeURIComponent(event.calendarId)}/events/${encodeURIComponent(event.eventId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          summary: event.summary,
          description: event.description,
          start: { dateTime: new Date(event.startTime).toISOString() },
          end: { dateTime: new Date(event.endTime).toISOString() }
        })
      }
    );
    return { id: result.id };
  }

  async deleteEvent({ calendarId, eventId }) {
    await this.request(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" }
    );
  }
}

export function createCalendar({ provider = "local", db, env = process.env, fetchImpl = fetch, logger = console } = {}) {
  if (provider === "local") return new LocalCalendar(db);
  if (provider === "google") {
    return new GoogleCalendar({
      auth: new GoogleAuth({ env, fetchImpl, logger }),
      apiBase: env.GOOGLE_CALENDAR_API_BASE,
      fetchImpl
    });
  }
  throw new CalendarConfigurationError(
    `Unknown CALENDAR_PROVIDER=${provider}. Expected "local" or "google".`
  );
}
