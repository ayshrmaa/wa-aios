import { randomUUID } from "node:crypto";

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

export class GoogleCalendar {
  constructor({ accessToken, apiBase = "https://www.googleapis.com/calendar/v3" }) {
    if (!accessToken) {
      throw new CalendarConfigurationError(
        "CALENDAR_PROVIDER=google requires GOOGLE_CALENDAR_ACCESS_TOKEN. No local fallback was used."
      );
    }
    this.provider = "google";
    this.accessToken = accessToken;
    this.apiBase = apiBase.replace(/\/$/, "");
  }

  async request(pathname, options = {}) {
    const response = await fetch(`${this.apiBase}${pathname}`, {
      ...options,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        "content-type": "application/json",
        ...options.headers
      }
    });
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

export function createCalendar({ provider = "local", db, env = process.env } = {}) {
  if (provider === "local") return new LocalCalendar(db);
  if (provider === "google") {
    return new GoogleCalendar({
      accessToken: env.GOOGLE_CALENDAR_ACCESS_TOKEN,
      apiBase: env.GOOGLE_CALENDAR_API_BASE
    });
  }
  throw new CalendarConfigurationError(
    `Unknown CALENDAR_PROVIDER=${provider}. Expected "local" or "google".`
  );
}
