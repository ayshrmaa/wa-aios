import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pgCredentials = {
  postgres: { id: "REPLACE_WITH_POSTGRES_CREDENTIAL_ID", name: "WA AIOS Postgres" }
};
const calendarCredentials = {
  googleCalendarOAuth2Api: {
    id: "REPLACE_WITH_GOOGLE_CALENDAR_CREDENTIAL_ID",
    name: "WA AIOS Google Calendar"
  }
};

function uuid(name) {
  const h = createHash("sha256").update(name).digest("hex").slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20)}`;
}

function node(name, type, typeVersion, position, parameters, extras = {}) {
  return { parameters, id: uuid(name), name, type, typeVersion, position, ...extras };
}

const webhook = (name, pathName, position) => node(name, "n8n-nodes-base.webhook", 2.1, position, {
  httpMethod: "POST", path: pathName, responseMode: "responseNode", options: {}
}, { webhookId: uuid(`webhook-${pathName}`) });

const postgres = (name, query, replacements, position, extras = {}) => node(
  name,
  "n8n-nodes-base.postgres",
  2.6,
  position,
  {
    operation: "executeQuery",
    query,
    options: replacements ? { queryReplacement: replacements } : {}
  },
  { credentials: pgCredentials, ...extras }
);

const code = (name, jsCode, position) => node(name, "n8n-nodes-base.code", 2, position, { jsCode });

const ifNode = (name, leftValue, operation, rightValue, position) => node(
  name,
  "n8n-nodes-base.if",
  2.2,
  position,
  {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
      conditions: [{
        id: uuid(`${name}-condition`),
        leftValue,
        rightValue,
        operator: operation
      }],
      combinator: "and"
    },
    options: {}
  }
);

const booleanTrue = { type: "boolean", operation: "true", singleValue: true };
const stringEquals = { type: "string", operation: "equals" };
const stringExists = { type: "string", operation: "exists", singleValue: true };

const respond = (name, body, position) => node(
  name,
  "n8n-nodes-base.respondToWebhook",
  1.5,
  position,
  { respondWith: "json", responseBody: body, options: {} }
);

const schedule = (name, minutes, position) => node(
  name,
  "n8n-nodes-base.scheduleTrigger",
  1.2,
  position,
  { rule: { interval: [{ field: "minutes", minutesInterval: minutes }] } }
);

const googleAvailability = (name, calendarExpr, startExpr, endExpr, position) => node(
  name,
  "n8n-nodes-base.googleCalendar",
  1.3,
  position,
  {
    resource: "calendar",
    calendar: { __rl: true, value: calendarExpr, mode: "id" },
    timeMin: startExpr,
    timeMax: endExpr,
    options: {}
  },
  { credentials: calendarCredentials }
);

const googleGetEvents = (name, calendarExpr, timeMin, timeMax, position) => node(
  name,
  "n8n-nodes-base.googleCalendar",
  1.3,
  position,
  {
    operation: "getAll",
    calendar: { __rl: true, value: calendarExpr, mode: "id" },
    returnAll: true,
    timeMin,
    timeMax,
    options: { singleEvents: true, orderBy: "startTime" }
  },
  { credentials: calendarCredentials, alwaysOutputData: true }
);

const googleFreeBusy = (name, bodyExpr, position) => node(
  name,
  "n8n-nodes-base.httpRequest",
  4.2,
  position,
  {
    method: "POST",
    url: "https://www.googleapis.com/calendar/v3/freeBusy",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "googleCalendarOAuth2Api",
    sendHeaders: true,
    headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
    sendBody: true,
    contentType: "raw",
    rawContentType: "application/json",
    body: bodyExpr,
    options: { timeout: 20000 }
  },
  { credentials: calendarCredentials }
);

const httpTransport = (name, position) => node(
  name,
  "n8n-nodes-base.httpRequest",
  4.2,
  position,
  {
    method: "POST",
    url: "={{ $env.MESSAGING_TRANSPORT_URL }}",
    sendHeaders: true,
    headerParameters: { parameters: [{ name: "Authorization", value: "={{ 'Bearer ' + $env.MESSAGING_TRANSPORT_TOKEN }}" }] },
    sendBody: true,
    contentType: "raw",
    rawContentType: "application/json",
    body: "={{ JSON.stringify($json.transportPayload) }}",
    options: { timeout: 20000 }
  }
);

function connect(connections, from, to, branch = 0) {
  connections[from] ??= { main: [] };
  while (connections[from].main.length <= branch) connections[from].main.push([]);
  connections[from].main[branch].push({ node: to, type: "main", index: 0 });
}

function workflow(name, nodes, connections) {
  return {
    name,
    nodes,
    pinData: {},
    connections,
    active: false,
    settings: { executionOrder: "v1", timezone: "Europe/Zurich" },
    versionId: uuid(`version-${name}`),
    meta: { templateCredsSetupCompleted: false },
    tags: []
  };
}

const swissCalendarHelpers = String.raw`
function parts(date, timezone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}
function dateKey(date, timezone) {
  const p = parts(date, timezone);
  return p.year + '-' + p.month + '-' + p.day;
}
function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
function holidaySet(year, region) {
  const easter = easterSunday(year);
  const dates = [
    year + '-01-01', year + '-08-01', year + '-12-25', year + '-12-26',
    addUtcDays(easter, -2).toISOString().slice(0, 10),
    addUtcDays(easter, 1).toISOString().slice(0, 10),
    addUtcDays(easter, 39).toISOString().slice(0, 10),
    addUtcDays(easter, 50).toISOString().slice(0, 10)
  ];
  if (region === 'ZH') dates.push(year + '-01-02', year + '-05-01');
  return new Set(dates);
}
function isQuiet(date, timezone, quiet) {
  const p = parts(date, timezone);
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  const [sh, sm] = quiet.start.split(':').map(Number);
  const [eh, em] = quiet.end.split(':').map(Number);
  const start = sh * 60 + sm, end = eh * 60 + em;
  return start > end ? minutes >= start || minutes < end : minutes >= start && minutes < end;
}
`;

const validateBookingCode = `${swissCalendarHelpers}
const row = $input.first().json;
const body = $('Book Appointment').first().json.body || {};
const booking = typeof row.adapter_config === 'string' ? JSON.parse(row.adapter_config) : (row.adapter_config || {});
const services = typeof row.services === 'string' ? JSON.parse(row.services) : (row.services || []);
const normalise = value => String(value || '').trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const requestedStaffId = normalise(body.staffId);
const staff = requestedStaffId
  ? (booking.staff || []).find(s => normalise(s.id) === requestedStaffId || normalise(s.name) === requestedStaffId || (s.aliases || []).some(a => normalise(a) === requestedStaffId))
  : (booking.staff || [])[0];
const requestedServiceId = normalise(body.serviceId);
const service = services.find(s => normalise(s.id || s.name) === requestedServiceId || normalise(s.name) === requestedServiceId);
const start = new Date(body.startTime);
const durationMinutes = Number(service?.durationMinutes || booking.defaultDurationMinutes);
const end = new Date(start.getTime() + durationMinutes * 60000);
let valid = true;
let code = 'ok';
let message = 'Slot is eligible for a final availability check.';
if (!row.id || !body.startTime || !body.serviceId || !body.customerName || !body.customerPhone || !staff || !service || Number.isNaN(start.getTime()) || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
  valid = false;
  code = !service && body.serviceId ? 'unknown_service' : (!staff && body.staffId ? 'unknown_staff' : 'invalid_request');
  message = code === 'unknown_service' ? 'I could not match that service to the salon menu.' : code === 'unknown_staff' ? 'I could not match that stylist to the salon team.' : 'Please provide startTime, serviceId, customerName and customerPhone.';
} else {
  const p = parts(start, row.timezone);
  const dayName = p.weekday.toLowerCase();
  const localStart = Number(p.hour) * 60 + Number(p.minute);
  const endParts = parts(end, row.timezone);
  const localEnd = Number(endParts.hour) * 60 + Number(endParts.minute);
  const sameDay = dateKey(start, row.timezone) === dateKey(end, row.timezone);
  const opening = booking.hours[dayName] || [];
  const withinHours = sameDay && opening.some(window => {
    const [sh, sm] = window.start.split(':').map(Number);
    const [eh, em] = window.end.split(':').map(Number);
    return localStart >= sh * 60 + sm && localEnd <= eh * 60 + em;
  });
  const localDate = dateKey(start, row.timezone);
  const closed = (booking.closureDates || []).includes(localDate) || (booking.additionalHolidayDates || []).includes(localDate);
  const holiday = holidaySet(Number(p.year), booking.swissHolidayRegion).has(localDate);
  if (!withinHours || closed || holiday) {
    valid = false; code = 'closed'; message = 'That time is outside opening hours or falls on a closure or Swiss public holiday.';
  }
}
const requestId = String(body.requestId || body.request_id || $execution.id);
const safeStart = Number.isNaN(start.getTime()) ? String(body.startTime || 'invalid') : start.toISOString();
const safeEnd = Number.isNaN(end.getTime()) ? 'invalid' : end.toISOString();
return [{ json: {
  valid, code, message, tenantId: row.id, timezone: row.timezone, booking,
  staffId: staff?.id, staffName: staff?.name, calendarId: staff?.calendarId,
  startTime: Number.isNaN(start.getTime()) ? body.startTime : start.toISOString(),
  endTime: Number.isNaN(end.getTime()) ? null : end.toISOString(), durationMinutes,
  requestId,
  lockKey: staff ? staff.id + ':' + safeStart + ':' + safeEnd : requestId,
  contactName: String(body.customerName || ''), phoneNumber: String(body.customerPhone || ''),
  customerEmail: String(body.customerEmail || ''), notes: String(body.notes || ''),
  serviceId: body.serviceId, service: service?.name || String(body.serviceId || ''),
  valueChf: Number(service?.priceChf || row.avg_appointment_value_chf), leadSource: 'call'
} }];`;

const alternativesCode = `${swissCalendarHelpers}
const ctx = $('Validate Booking Request').first().json;
const events = $input.all().map(i => i.json).filter(e => e.start && e.end);
const duration = new Date(ctx.endTime) - new Date(ctx.startTime);
const requested = new Date(ctx.startTime);
const config = ctx.booking;
const busy = events.map(e => [new Date(e.start.dateTime || e.start.date), new Date(e.end.dateTime || e.end.date)]);
function zonedToUtc(dateString, timeString, timezone) {
  const [y,m,d] = dateString.split('-').map(Number), [hh,mm] = timeString.split(':').map(Number);
  const guess = new Date(Date.UTC(y,m-1,d,hh,mm));
  const p = parts(guess, timezone);
  const represented = Date.UTC(Number(p.year), Number(p.month)-1, Number(p.day), Number(p.hour), Number(p.minute));
  return new Date(guess.getTime() - (represented - guess.getTime()));
}
const slots = [];
for (let day = 0; day < config.searchRangeDays; day++) {
  const probe = new Date(requested.getTime() + day * 86400000);
  const p = parts(probe, ctx.timezone), key = p.year + '-' + p.month + '-' + p.day;
  if ((config.closureDates || []).includes(key) || (config.additionalHolidayDates || []).includes(key) || holidaySet(Number(p.year), config.swissHolidayRegion).has(key)) continue;
  for (const window of (config.hours[p.weekday.toLowerCase()] || [])) {
    let cursor = zonedToUtc(key, window.start, ctx.timezone);
    const close = zonedToUtc(key, window.end, ctx.timezone);
    while (cursor.getTime() + duration <= close.getTime()) {
      const end = new Date(cursor.getTime() + duration);
      if (!busy.some(([a,b]) => cursor < b && end > a) && cursor > new Date()) {
        slots.push({ startTime: cursor.toISOString(), endTime: end.toISOString(), distance: Math.abs(cursor - requested) });
      }
      cursor = new Date(cursor.getTime() + config.slotIntervalMinutes * 60000);
    }
  }
}
slots.sort((a,b) => a.distance - b.distance);
return [{ json: { status: 'unavailable', code: 'slot_taken', message: 'That slot was just taken. Please offer one of these alternatives.', staff: ctx.staffName, alternativeSlots: slots.slice(0,3).map(({distance,...slot}) => slot) } }];`;

function buildBookingWorkflow() {
  const nodes = [];
  const connections = {};

  nodes.push(webhook("Book Appointment", "book-appointment", [-1420, -300]));
  nodes.push(postgres("Load Tenant Configuration", `select id, name, timezone, avg_appointment_value_chf, adapter_config, services
from tenants where id = $1::uuid limit 1`, "={{ [($('Book Appointment').first().json.body || {}).tenantId || ($('Book Appointment').first().json.body || {}).tenant_id || ($('Book Appointment').first().json.query || {}).tenantId || $env.TENANT_ID] }}", [-1200, -300], { alwaysOutputData: true }));
  nodes.push(code("Validate Booking Request", validateBookingCode, [-980, -300]));
  nodes.push(ifNode("Booking Request Valid?", "={{ $json.valid }}", booleanTrue, true, [-760, -300]));
  nodes.push(respond("Return Validation Failure", "={{ { status: 'not_booked', code: $json.code, message: $json.message } }}", [-540, -100]));
  nodes.push(postgres("Acquire Atomic Slot Lock", `select * from try_acquire_booking_slot($1::uuid, $2, $3::timestamptz, $4::timestamptz, $5)`, "={{ [$json.tenantId, $json.calendarId, $json.startTime, $json.endTime, $json.lockKey] }}", [-540, -420]));
  nodes.push(ifNode("Slot Lock Acquired?", "={{ $json.locked }}", booleanTrue, true, [-320, -420]));
  nodes.push(googleAvailability("Re-verify Staff Calendar", "={{ $('Validate Booking Request').first().json.calendarId }}", "={{ $('Validate Booking Request').first().json.startTime }}", "={{ $('Validate Booking Request').first().json.endTime }}", [-100, -500]));
  nodes.push(ifNode("Calendar Still Available?", "={{ $json.available }}", booleanTrue, true, [120, -500]));
  nodes.push(node("Create Staff Calendar Event", "n8n-nodes-base.googleCalendar", 1.3, [340, -620], {
    calendar: { __rl: true, value: "={{ $('Validate Booking Request').first().json.calendarId }}", mode: "id" },
    start: "={{ $('Validate Booking Request').first().json.startTime }}",
    end: "={{ $('Validate Booking Request').first().json.endTime }}",
    additionalFields: {
      description: "={{ 'Phone: ' + $('Validate Booking Request').first().json.phoneNumber + '\\nTenant: ' + $('Validate Booking Request').first().json.tenantId + ($('Validate Booking Request').first().json.notes ? '\\nNotes: ' + $('Validate Booking Request').first().json.notes : '') }}",
      summary: "={{ $('Validate Booking Request').first().json.contactName + ' - ' + $('Validate Booking Request').first().json.service }}"
    }
  }, { credentials: calendarCredentials }));
  nodes.push(postgres("Persist Appointment and Release Lock", `with contact_row as (
  insert into contacts (tenant_id, first_name, phone_e164, email, source, whatsapp_consent, email_consent)
  values ($1::uuid, $2, nullif($3,''), nullif($4,''), $5, true, (nullif($4,'') is not null))
  on conflict (tenant_id, phone_e164) do update set first_name = excluded.first_name, email = coalesce(excluded.email, contacts.email), updated_at = now()
  returning id
), appointment_row as (
  insert into appointments (tenant_id, contact_id, external_id, platform, status, status_source, starts_at, ends_at, service, value_chf, staff, staff_calendar_id, lead_source)
  select $1::uuid, id, $6, 'google_calendar', 'booked', 'workflow', $7::timestamptz, $8::timestamptz, $9, $10::numeric, $11, $12, $5 from contact_row
  returning *
), event_row as (
  insert into events (tenant_id, aggregate_type, aggregate_id, event_type, source, payload)
  select tenant_id, 'appointment', id, 'appointment.created', 'n8n.booking', jsonb_build_object('external_id', external_id, 'staff', staff) from appointment_row
), released as (
  delete from booking_slot_locks where id = $13::uuid
)
select id::text, external_id, starts_at, ends_at, staff from appointment_row`, "={{ [ $('Validate Booking Request').first().json.tenantId, $('Validate Booking Request').first().json.contactName, $('Validate Booking Request').first().json.phoneNumber, $('Validate Booking Request').first().json.customerEmail, $('Validate Booking Request').first().json.leadSource, $json.id, $('Validate Booking Request').first().json.startTime, $('Validate Booking Request').first().json.endTime, $('Validate Booking Request').first().json.service, $('Validate Booking Request').first().json.valueChf, $('Validate Booking Request').first().json.staffName, $('Validate Booking Request').first().json.calendarId, $('Acquire Atomic Slot Lock').first().json.lock_id ] }}", [560, -620], { onError: "continueRegularOutput" }));
  nodes.push(ifNode("Appointment Persisted?", "={{ $json.id }}", stringExists, "", [780, -620]));
  nodes.push(respond("Return Booking Success", "={{ { status: 'booked', appointmentId: $json.id, startTime: $json.starts_at, endTime: $json.ends_at, staff: $json.staff, message: 'Appointment successfully booked.' } }}", [1000, -700]));
  nodes.push(node("Compensate Calendar Event", "n8n-nodes-base.googleCalendar", 1.3, [1000, -520], {
    operation: "delete",
    calendar: { __rl: true, value: "={{ $('Validate Booking Request').first().json.calendarId }}", mode: "id" },
    eventId: "={{ $('Create Staff Calendar Event').first().json.id }}",
    options: {}
  }, { credentials: calendarCredentials, onError: "continueRegularOutput" }));
  nodes.push(postgres("Release Failed Booking Lock", "delete from booking_slot_locks where id = $1::uuid returning id::text", "={{ [$('Acquire Atomic Slot Lock').first().json.lock_id] }}", [1220, -520], { alwaysOutputData: true }));
  nodes.push(respond("Return Persistence Failure", "={{ { status: 'not_booked', code: 'persistence_failed', message: 'The booking could not be completed. No calendar event was kept. Please try another slot.' } }}", [1440, -520]));
  nodes.push(postgres("Release Busy Slot Lock", "delete from booking_slot_locks where id = $1::uuid returning id::text", "={{ [$('Acquire Atomic Slot Lock').first().json.lock_id] }}", [340, -340], { alwaysOutputData: true }));
  nodes.push(googleGetEvents("Get Staff Events for Alternatives", "={{ $('Validate Booking Request').first().json.calendarId }}", "={{ $('Validate Booking Request').first().json.startTime }}", "={{ new Date(new Date($('Validate Booking Request').first().json.startTime).getTime() + $('Validate Booking Request').first().json.booking.searchRangeDays * 86400000).toISOString() }}", [560, -220]));
  nodes.push(code("Find 3 Alternatives", alternativesCode, [780, -220]));
  nodes.push(respond("Return Slot Alternatives", "={{ $json }}", [1000, -220]));

  nodes.push(webhook("Cancel Appointment", "cancel-appointment", [-1420, 180]));
  nodes.push(postgres("Find Appointment to Cancel", `select a.id::text, a.external_id, a.staff_calendar_id, a.tenant_id::text
from appointments a
where a.tenant_id = $1::uuid and a.id = $2::uuid and a.status = 'booked' and a.starts_at > now()
limit 1`, "={{ [($json.body || {}).tenantId || ($json.body || {}).tenant_id || ($json.query || {}).tenantId || $env.TENANT_ID, ($json.body || {}).appointmentId] }}", [-1200, 180], { alwaysOutputData: true }));
  nodes.push(ifNode("Cancellation Appointment Found?", "={{ $json.id }}", stringExists, "", [-980, 180]));
  nodes.push(node("Delete Staff Calendar Event", "n8n-nodes-base.googleCalendar", 1.3, [-760, 80], {
    operation: "delete",
    calendar: { __rl: true, value: "={{ $('Find Appointment to Cancel').first().json.staff_calendar_id }}", mode: "id" },
    eventId: "={{ $('Find Appointment to Cancel').first().json.external_id }}",
    options: {}
  }, { credentials: calendarCredentials }));
  nodes.push(postgres("Mark Appointment Cancelled", `with updated as (
  update appointments set status = 'cancelled', status_source = 'workflow' where id = $1::uuid returning tenant_id, id
)
insert into events (tenant_id, aggregate_type, aggregate_id, event_type, source, payload)
select tenant_id, 'appointment', id, 'appointment.cancelled', 'n8n.booking', jsonb_build_object('reason',nullif($2::text,'')) from updated returning id::text`, "={{ [$('Find Appointment to Cancel').first().json.id, ($('Cancel Appointment').first().json.body || {}).reason || ''] }}", [-540, 80]));
  nodes.push(respond("Return Cancellation Success", "={{ { status: 'cancelled', message: 'Your appointment has been cancelled.' } }}", [-320, 80]));
  nodes.push(respond("Return Cancellation Not Found", "={{ { status: 'not_found', message: 'That upcoming appointment could not be found.' } }}", [-760, 280]));

  nodes.push(webhook("Reschedule Appointment", "reschedule-appointment", [-1420, 660]));
  nodes.push(postgres("Load Reschedule Context", `select a.id::text as appointment_id, a.external_id, a.staff, a.staff_calendar_id, a.tenant_id::text as tenant_id, a.starts_at as old_starts_at, a.ends_at as old_ends_at,
       t.timezone, t.adapter_config, t.services, t.avg_appointment_value_chf
from appointments a join tenants t on t.id = a.tenant_id
where a.tenant_id = $1::uuid and a.id = $2::uuid and a.status = 'booked' and a.starts_at > now()
limit 1`, "={{ [($json.body || {}).tenantId || ($json.body || {}).tenant_id || ($json.query || {}).tenantId || $env.TENANT_ID, ($json.body || {}).appointmentId] }}", [-1200, 660], { alwaysOutputData: true }));
  nodes.push(ifNode("Reschedule Appointment Found?", "={{ $json.appointment_id }}", stringExists, "", [-980, 660]));
  nodes.push(code("Validate Reschedule Slot", `${swissCalendarHelpers}
const row = $input.first().json, body = $('Reschedule Appointment').first().json.body || {};
const booking = typeof row.adapter_config === 'string' ? JSON.parse(row.adapter_config) : row.adapter_config;
const start = new Date(body.newStartTime);
const duration = new Date(row.old_ends_at) - new Date(row.old_starts_at);
const end = new Date(start.getTime() + duration);
let valid = !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start;
if (valid) {
  const p = parts(start, row.timezone), ep = parts(end, row.timezone), key = dateKey(start, row.timezone);
  const startMin = Number(p.hour)*60+Number(p.minute), endMin = Number(ep.hour)*60+Number(ep.minute);
  const windows = booking.hours[p.weekday.toLowerCase()] || [];
  valid = key === dateKey(end,row.timezone) && windows.some(w => { const s=w.start.split(':').map(Number), e=w.end.split(':').map(Number); return startMin>=s[0]*60+s[1] && endMin<=e[0]*60+e[1]; });
  valid = valid && !(booking.closureDates||[]).includes(key) && !(booking.additionalHolidayDates||[]).includes(key) && !holidaySet(Number(p.year),booking.swissHolidayRegion).has(key);
}
const requestId = String(body.requestId || body.request_id || $execution.id);
const safeStart = Number.isNaN(start.getTime()) ? String(body.newStartTime || 'invalid') : start.toISOString();
const safeEnd = Number.isNaN(end.getTime()) ? 'invalid' : end.toISOString();
return [{json:{...row, valid, startTime:Number.isNaN(start.getTime())?body.newStartTime:start.toISOString(), endTime:Number.isNaN(end.getTime())?null:end.toISOString(), requestId, lockKey:row.staff_calendar_id + ':' + safeStart + ':' + safeEnd}}];`, [-760, 560]));
  nodes.push(ifNode("Reschedule Slot Valid?", "={{ $json.valid }}", booleanTrue, true, [-540, 560]));
  nodes.push(postgres("Acquire Reschedule Slot Lock", "select * from try_acquire_booking_slot($1::uuid,$2,$3::timestamptz,$4::timestamptz,$5)", "={{ [$json.tenant_id, $json.staff_calendar_id, $json.startTime, $json.endTime, $json.lockKey] }}", [-320, 460]));
  nodes.push(ifNode("Reschedule Lock Acquired?", "={{ $json.locked }}", booleanTrue, true, [-100, 460]));
  nodes.push(googleAvailability("Re-verify Reschedule Calendar", "={{ $('Validate Reschedule Slot').first().json.staff_calendar_id }}", "={{ $('Validate Reschedule Slot').first().json.startTime }}", "={{ $('Validate Reschedule Slot').first().json.endTime }}", [120, 380]));
  nodes.push(ifNode("Reschedule Calendar Available?", "={{ $json.available }}", booleanTrue, true, [340, 380]));
  nodes.push(node("Update Staff Calendar Event", "n8n-nodes-base.googleCalendar", 1.3, [560, 260], {
    operation: "update",
    calendar: { __rl: true, value: "={{ $('Validate Reschedule Slot').first().json.staff_calendar_id }}", mode: "id" },
    eventId: "={{ $('Validate Reschedule Slot').first().json.external_id }}",
    updateFields: {
      start: "={{ $('Validate Reschedule Slot').first().json.startTime }}",
      end: "={{ $('Validate Reschedule Slot').first().json.endTime }}"
    }
  }, { credentials: calendarCredentials }));
  nodes.push(postgres("Persist Reschedule and Release Lock", `with updated as (
  update appointments set starts_at=$2::timestamptz, ends_at=$3::timestamptz, status_source='workflow' where id=$1::uuid returning tenant_id,id,starts_at,ends_at
), event_row as (
  insert into events (tenant_id,aggregate_type,aggregate_id,event_type,source,payload)
  select tenant_id,'appointment',id,'appointment.rescheduled','n8n.booking',jsonb_build_object('starts_at',starts_at,'ends_at',ends_at) from updated
), released as (delete from booking_slot_locks where id=$4::uuid)
select id::text, starts_at, ends_at from updated`, "={{ [ $('Validate Reschedule Slot').first().json.appointment_id, $('Validate Reschedule Slot').first().json.startTime, $('Validate Reschedule Slot').first().json.endTime, $('Acquire Reschedule Slot Lock').first().json.lock_id ] }}", [780, 260]));
  nodes.push(respond("Return Reschedule Success", "={{ { status:'rescheduled', startTime:$json.starts_at, endTime:$json.ends_at, message:'Appointment successfully rescheduled.' } }}", [1000, 260]));
  nodes.push(postgres("Release Reschedule Lock", "delete from booking_slot_locks where id=$1::uuid returning id::text", "={{ [$('Acquire Reschedule Slot Lock').first().json.lock_id] }}", [560, 500], { alwaysOutputData: true }));
  nodes.push(respond("Return Reschedule Unavailable", "={{ { status:'not_rescheduled', code:'slot_unavailable', message:'The requested time is unavailable. Please choose another time.' } }}", [780, 500]));
  nodes.push(respond("Return Invalid Reschedule", "={{ { status:'not_rescheduled', code:'closed', message:'That time is outside opening hours or falls on a closure or Swiss public holiday.' } }}", [-320, 680]));
  nodes.push(respond("Return Reschedule Not Found", "={{ { status:'not_found', message:'No upcoming appointment was found for that phone number.' } }}", [-760, 780]));

  connect(connections, "Book Appointment", "Load Tenant Configuration");
  connect(connections, "Load Tenant Configuration", "Validate Booking Request");
  connect(connections, "Validate Booking Request", "Booking Request Valid?");
  connect(connections, "Booking Request Valid?", "Acquire Atomic Slot Lock", 0);
  connect(connections, "Booking Request Valid?", "Return Validation Failure", 1);
  connect(connections, "Acquire Atomic Slot Lock", "Slot Lock Acquired?");
  connect(connections, "Slot Lock Acquired?", "Re-verify Staff Calendar", 0);
  connect(connections, "Slot Lock Acquired?", "Get Staff Events for Alternatives", 1);
  connect(connections, "Re-verify Staff Calendar", "Calendar Still Available?");
  connect(connections, "Calendar Still Available?", "Create Staff Calendar Event", 0);
  connect(connections, "Calendar Still Available?", "Release Busy Slot Lock", 1);
  connect(connections, "Create Staff Calendar Event", "Persist Appointment and Release Lock");
  connect(connections, "Persist Appointment and Release Lock", "Appointment Persisted?");
  connect(connections, "Appointment Persisted?", "Return Booking Success", 0);
  connect(connections, "Appointment Persisted?", "Compensate Calendar Event", 1);
  connect(connections, "Compensate Calendar Event", "Release Failed Booking Lock");
  connect(connections, "Release Failed Booking Lock", "Return Persistence Failure");
  connect(connections, "Release Busy Slot Lock", "Get Staff Events for Alternatives");
  connect(connections, "Get Staff Events for Alternatives", "Find 3 Alternatives");
  connect(connections, "Find 3 Alternatives", "Return Slot Alternatives");
  connect(connections, "Cancel Appointment", "Find Appointment to Cancel");
  connect(connections, "Find Appointment to Cancel", "Cancellation Appointment Found?");
  connect(connections, "Cancellation Appointment Found?", "Delete Staff Calendar Event", 0);
  connect(connections, "Cancellation Appointment Found?", "Return Cancellation Not Found", 1);
  connect(connections, "Delete Staff Calendar Event", "Mark Appointment Cancelled");
  connect(connections, "Mark Appointment Cancelled", "Return Cancellation Success");
  connect(connections, "Reschedule Appointment", "Load Reschedule Context");
  connect(connections, "Load Reschedule Context", "Reschedule Appointment Found?");
  connect(connections, "Reschedule Appointment Found?", "Validate Reschedule Slot", 0);
  connect(connections, "Reschedule Appointment Found?", "Return Reschedule Not Found", 1);
  connect(connections, "Validate Reschedule Slot", "Reschedule Slot Valid?");
  connect(connections, "Reschedule Slot Valid?", "Acquire Reschedule Slot Lock", 0);
  connect(connections, "Reschedule Slot Valid?", "Return Invalid Reschedule", 1);
  connect(connections, "Acquire Reschedule Slot Lock", "Reschedule Lock Acquired?");
  connect(connections, "Reschedule Lock Acquired?", "Re-verify Reschedule Calendar", 0);
  connect(connections, "Reschedule Lock Acquired?", "Return Reschedule Unavailable", 1);
  connect(connections, "Re-verify Reschedule Calendar", "Reschedule Calendar Available?");
  connect(connections, "Reschedule Calendar Available?", "Update Staff Calendar Event", 0);
  connect(connections, "Reschedule Calendar Available?", "Release Reschedule Lock", 1);
  connect(connections, "Update Staff Calendar Event", "Persist Reschedule and Release Lock");
  connect(connections, "Persist Reschedule and Release Lock", "Return Reschedule Success");
  connect(connections, "Release Reschedule Lock", "Return Reschedule Unavailable");

  return workflow("WA AIOS - Google Calendar Booking", nodes, connections);
}

const prepareAvailabilityCode = `${swissCalendarHelpers}
const row = $input.first().json;
const request = $('Check Availability').first().json;
const body = request.body || {};
const booking = typeof row.adapter_config === 'string' ? JSON.parse(row.adapter_config) : (row.adapter_config || {});
const services = typeof row.services === 'string' ? JSON.parse(row.services) : (row.services || []);
const normalise = value => String(value || '').trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const serviceKey = normalise(body.serviceId);
const service = services.find(s => normalise(s.id || s.name) === serviceKey || normalise(s.name) === serviceKey);
const staffKey = normalise(body.staffId);
const allStaff = booking.staff || [];
const candidates = staffKey
  ? allStaff.filter(s => normalise(s.id) === staffKey || normalise(s.name) === staffKey || (s.aliases || []).some(a => normalise(a) === staffKey))
  : allStaff;
const start = new Date(body.startTime);
const durationMinutes = Number(service?.durationMinutes || booking.defaultDurationMinutes);
const end = new Date(start.getTime() + durationMinutes * 60000);
const valid = Boolean(row.id && body.startTime && body.serviceId && service && candidates.length && !Number.isNaN(start.getTime()) && Number.isFinite(durationMinutes) && durationMinutes > 0);
let code = 'ok', message = 'Checking that time now.';
if (!valid) {
  code = !service && body.serviceId ? 'unknown_service' : (!candidates.length && body.staffId ? 'unknown_staff' : 'invalid_request');
  message = code === 'unknown_service' ? 'I could not match that service to the salon menu.' : code === 'unknown_staff' ? 'I could not match that stylist to the salon team.' : 'Please provide a valid startTime and serviceId.';
}
const rangeDays = Math.max(1, Number(booking.searchRangeDays || 10));
const requestedStart = Number.isNaN(start.getTime()) ? new Date().toISOString() : start.toISOString();
const timeMin = Number.isNaN(start.getTime()) ? new Date().toISOString() : new Date(start.getTime() - 86400000).toISOString();
const timeMax = Number.isNaN(start.getTime()) ? new Date().toISOString() : new Date(start.getTime() + rangeDays * 86400000).toISOString();
return [{json:{
  valid, code, message, tenantId:row.id, timezone:row.timezone || 'Europe/Zurich', booking,
  serviceId:body.serviceId, serviceName:service?.name, durationMinutes,
  requestedStart, requestedEnd:Number.isNaN(end.getTime()) ? null : end.toISOString(),
  candidates:candidates.map(s => ({staffId:s.id, staffName:s.name, calendarId:s.calendarId})),
  freeBusyRequest:{timeMin,timeMax,timeZone:row.timezone || 'Europe/Zurich',items:candidates.map(s => ({id:s.calendarId}))}
}}];`;

const evaluateAvailabilityCode = `${swissCalendarHelpers}
const ctx = $('Prepare Availability Query').first().json;
const response = $input.first().json || {};
const calendarResults = response.calendars || {};
const requested = new Date(ctx.requestedStart);
const durationMs = Number(ctx.durationMinutes) * 60000;
const booking = ctx.booking;
function zonedToUtc(dateString, timeString, timezone) {
  const values = dateString.split('-').map(Number), clock = timeString.split(':').map(Number);
  const guess = new Date(Date.UTC(values[0], values[1]-1, values[2], clock[0], clock[1]));
  const p = parts(guess, timezone);
  const represented = Date.UTC(Number(p.year), Number(p.month)-1, Number(p.day), Number(p.hour), Number(p.minute));
  return new Date(guess.getTime() - (represented - guess.getTime()));
}
function busyFor(staff) {
  return (calendarResults[staff.calendarId]?.busy || []).map(period => [new Date(period.start), new Date(period.end)]);
}
function eligible(staff, start) {
  const calendar = calendarResults[staff.calendarId];
  if (!calendar || (calendar.errors || []).length) return false;
  const end = new Date(start.getTime() + durationMs);
  const p = parts(start, ctx.timezone), ep = parts(end, ctx.timezone), key = dateKey(start, ctx.timezone);
  const startMinutes = Number(p.hour) * 60 + Number(p.minute), endMinutes = Number(ep.hour) * 60 + Number(ep.minute);
  const windows = booking.hours?.[p.weekday.toLowerCase()] || [];
  const inHours = key === dateKey(end, ctx.timezone) && windows.some(window => {
    const a = window.start.split(':').map(Number), b = window.end.split(':').map(Number);
    return startMinutes >= a[0] * 60 + a[1] && endMinutes <= b[0] * 60 + b[1];
  });
  const closed = (booking.closureDates || []).includes(key) || (booking.additionalHolidayDates || []).includes(key) || holidaySet(Number(p.year), booking.swissHolidayRegion).has(key);
  const overlaps = busyFor(staff).some(([a,b]) => start < b && end > a);
  return inHours && !closed && !overlaps && start > new Date();
}
function spoken(date) {
  return new Intl.DateTimeFormat('en-GB', {timeZone:ctx.timezone,weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
}
const availableStaff = ctx.candidates.find(staff => eligible(staff, requested));
if (availableStaff) {
  const phrase = spoken(requested);
  return [{json:{available:true,startTime:requested.toISOString(),endTime:new Date(requested.getTime()+durationMs).toISOString(),staffId:availableStaff.staffId,staffName:availableStaff.staffName,serviceId:ctx.serviceId,service:ctx.serviceName,message:'Yes, ' + availableStaff.staffName + ' is available on ' + phrase + ' for ' + ctx.serviceName + '.'}}];
}
const slots = [];
for (let day = 0; day < Number(booking.searchRangeDays || 10); day++) {
  const probe = new Date(requested.getTime() + day * 86400000);
  const p = parts(probe, ctx.timezone), key = p.year + '-' + p.month + '-' + p.day;
  for (const window of (booking.hours?.[p.weekday.toLowerCase()] || [])) {
    const close = zonedToUtc(key, window.end, ctx.timezone);
    for (let cursor = zonedToUtc(key, window.start, ctx.timezone); cursor.getTime() + durationMs <= close.getTime(); cursor = new Date(cursor.getTime() + Number(booking.slotIntervalMinutes || 30) * 60000)) {
      for (const staff of ctx.candidates) {
        if (eligible(staff, cursor)) slots.push({startTime:cursor.toISOString(),endTime:new Date(cursor.getTime()+durationMs).toISOString(),staffId:staff.staffId,staffName:staff.staffName,spokenTime:spoken(cursor),distance:Math.abs(cursor-requested)});
      }
    }
  }
}
slots.sort((a,b) => a.distance-b.distance || a.startTime.localeCompare(b.startTime) || a.staffName.localeCompare(b.staffName));
const uniqueSlots = [];
const seenStarts = new Set();
for (const slot of slots) {
  if (seenStarts.has(slot.startTime)) continue;
  seenStarts.add(slot.startTime);
  uniqueSlots.push(slot);
}
const alternatives = uniqueSlots.slice(0,3).map(({distance,...slot}) => slot);
const message = alternatives.length
  ? 'That time is not available. The closest options are ' + alternatives.map(slot => slot.spokenTime + ' with ' + slot.staffName).join(', ') + '.'
  : 'That time is not available, and I could not find another opening in the next ' + Number(booking.searchRangeDays || 10) + ' days.';
return [{json:{available:false,serviceId:ctx.serviceId,service:ctx.serviceName,alternatives,message}}];`;

function buildRetellToolsWorkflow() {
  const nodes = [];
  const connections = {};

  nodes.push(webhook("Check Availability", "check-availability", [-1240, -520]));
  nodes.push(postgres("Load Availability Tenant Config", `select id, timezone, adapter_config, services
from tenants where id=$1::uuid limit 1`, "={{ [($json.body || {}).tenantId || ($json.body || {}).tenant_id || ($json.query || {}).tenantId || $env.TENANT_ID] }}", [-1020, -520], { alwaysOutputData: true }));
  nodes.push(code("Prepare Availability Query", prepareAvailabilityCode, [-800, -520]));
  nodes.push(ifNode("Availability Request Valid?", "={{ $json.valid }}", booleanTrue, true, [-580, -520]));
  nodes.push(googleFreeBusy("Check Google Calendar Free Busy", "={{ JSON.stringify($json.freeBusyRequest) }}", [-360, -620]));
  nodes.push(code("Choose Slot or Alternatives", evaluateAvailabilityCode, [-140, -620]));
  nodes.push(respond("Return Availability", "={{ $json }}", [80, -620]));
  nodes.push(respond("Return Availability Error", "={{ { available:false, code:$json.code, alternatives:[], message:$json.message } }}", [-360, -400]));

  nodes.push(webhook("Find Appointment", "find-appointment", [-1240, -80]));
  nodes.push(postgres("Find Upcoming Appointments", `select a.id::text as appointment_id,a.starts_at,a.ends_at,a.service,a.staff,t.timezone
from appointments a join contacts c on c.id=a.contact_id join tenants t on t.id=a.tenant_id
where a.tenant_id=$1::uuid
  and regexp_replace(coalesce(c.phone_e164,''),'[^0-9]','','g')=regexp_replace(coalesce($2,''),'[^0-9]','','g')
  and a.status='booked' and a.starts_at>now()
order by a.starts_at`, "={{ [($json.body || {}).tenantId || ($json.body || {}).tenant_id || ($json.query || {}).tenantId || $env.TENANT_ID, ($json.body || {}).customerPhone] }}", [-1020, -80], { alwaysOutputData: true }));
  nodes.push(code("Format Upcoming Appointments", `const rows=$input.all().map(item=>item.json).filter(row=>row.appointment_id); const timezone=rows[0]?.timezone||'Europe/Zurich'; const spoken=date=>new Intl.DateTimeFormat('en-GB',{timeZone:timezone,weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(date)); const appointments=rows.map(row=>({appointmentId:row.appointment_id,startTime:row.starts_at,endTime:row.ends_at,service:row.service,staff:row.staff,spokenSummary:row.service+' with '+row.staff+' on '+spoken(row.starts_at)})); const message=appointments.length?(appointments.length===1?'I found '+appointments[0].spokenSummary+'.':'I found '+appointments.length+' upcoming appointments: '+appointments.map(a=>a.spokenSummary).join('; ')+'.'):'I could not find any upcoming appointments for that phone number.'; return [{json:{found:appointments.length>0,appointments,message}}];`, [-800, -80]));
  nodes.push(respond("Return Upcoming Appointments", "={{ $json }}", [-580, -80]));

  nodes.push(webhook("Log Complaint", "log-complaint", [-1240, 340]));
  nodes.push(code("Normalise Complaint", `const request=$input.first().json,body=request.body||{}; const allowed=new Set(['low','medium','high','urgent']); const severity=allowed.has(String(body.severity||'medium').toLowerCase())?String(body.severity||'medium').toLowerCase():'medium'; return [{json:{tenantId:body.tenantId||body.tenant_id||(request.query||{}).tenantId||$env.TENANT_ID,customerPhone:String(body.customerPhone||''),customerName:String(body.customerName||'Caller'),summary:String(body.summary||''),severity}}];`, [-1020, 340]));
  nodes.push(postgres("Persist Complaint Before Alert", `with tenant_row as (
  select id,review_config,messaging_config from tenants where id=$1::uuid
), contact_row as (
  insert into contacts(tenant_id,first_name,phone_e164,source)
  select id,$2,nullif($3,''),'call' from tenant_row
  on conflict(tenant_id,phone_e164) do update set first_name=excluded.first_name,updated_at=now()
  returning id,tenant_id
), complaint_row as (
  insert into complaints(tenant_id,contact_id,source_channel,detected_category,severity,body)
  select tenant_id,id,'phone','voice_complaint',$4,$5 from contact_row returning id,tenant_id,contact_id
), event_row as (
  insert into events(tenant_id,aggregate_type,aggregate_id,event_type,source,payload)
  select tenant_id,'complaint',id,'complaint.created','retell',jsonb_build_object('severity',$4) from complaint_row
)
select complaint_row.id::text as complaint_id,complaint_row.contact_id::text,
       tenant_row.review_config->>'ownerAlertEmail' as owner_email,
       coalesce(tenant_row.messaging_config->>'mode','stub') as messaging_mode
from complaint_row cross join tenant_row`, "={{ [$json.tenantId,$json.customerName,$json.customerPhone,$json.severity,$json.summary] }}", [-800, 340]));
  nodes.push(code("Prepare Owner Alert", `const saved=$input.first().json,complaint=$('Normalise Complaint').first().json; const ownerEmail=String(saved.owner_email||''); const alertMode=saved.messaging_mode==='live'&&ownerEmail?'live':'stub'; const body='Complaint from '+complaint.customerName+' ('+complaint.customerPhone+'), severity '+complaint.severity+': '+complaint.summary; return [{json:{...saved,...complaint,ownerEmail,alertMode,alertBody:body,transportPayload:{tenantId:complaint.tenantId,channel:'email',to:ownerEmail,templateId:'owner_complaint_alert',body}}}];`, [-580, 340]));
  nodes.push(ifNode("Owner Alert Transport Live?", "={{ $json.alertMode }}", stringEquals, "live", [-360, 340]));
  nodes.push(httpTransport("Send Owner Complaint Alert", [-140, 240]));
  nodes.push(code("LOUD STUB Owner Complaint Alert", `console.warn('[WA AIOS STUB] Would alert owner about complaint:',JSON.stringify($json.transportPayload)); return $input.all().map(item=>({json:{...item.json,delivery_status:'stubbed'}}));`, [-140, 440]));
  nodes.push(postgres("Record Owner Alert", `with message_row as (
  insert into messages(tenant_id,contact_id,channel,direction,body,template_id,delivery_status,sent_at)
  values($1::uuid,$2::uuid,'email','outbound',$3,'owner_complaint_alert',$4,case when $4='sent' then now() else null end)
), updated as (
  update complaints set notified_at=case when $4='sent' then now() else notified_at end where id=$5::uuid
)
select $5::text as complaint_id,$4::text as owner_alert`, "={{ [$('Prepare Owner Alert').first().json.tenantId,$('Prepare Owner Alert').first().json.contact_id,$('Prepare Owner Alert').first().json.alertBody,$('Prepare Owner Alert').first().json.alertMode==='live'?'sent':'stubbed',$('Prepare Owner Alert').first().json.complaint_id] }}", [80, 340]));
  nodes.push(respond("Acknowledge Complaint", "={{ { logged:true, complaintId:$json.complaint_id, ownerAlert:$json.owner_alert, automatedCustomerReply:false, message:$json.owner_alert==='sent'?'The complaint has been logged and the owner has been alerted.':'The complaint has been logged. The owner alert is saved but its transport still needs configuration.' } }}", [300, 340]));

  nodes.push(webhook("Log Callback", "log-callback", [-1240, 760]));
  nodes.push(postgres("Persist Callback Request", `with contact_row as (
  insert into contacts(tenant_id,first_name,phone_e164,source)
  values($1::uuid,$2,nullif($3,''),'call')
  on conflict(tenant_id,phone_e164) do update set first_name=excluded.first_name,updated_at=now()
  returning id,tenant_id
), event_row as (
  insert into events(tenant_id,aggregate_type,aggregate_id,event_type,source,payload)
  select tenant_id,'callback_request',id,'callback.requested','retell',jsonb_build_object('customerName',$2,'customerPhone',$3,'reason',$4,'requestedAt',now()) from contact_row
  returning id,aggregate_id
)
select id::text as callback_request_id,aggregate_id::text as contact_id from event_row`, "={{ [($json.body || {}).tenantId || ($json.body || {}).tenant_id || ($json.query || {}).tenantId || $env.TENANT_ID, ($json.body || {}).customerName || 'Caller', ($json.body || {}).customerPhone, ($json.body || {}).reason || 'Out-of-hours callback requested'] }}", [-1020, 760]));
  nodes.push(respond("Acknowledge Callback", "={{ { logged:true, callbackRequestId:$json.callback_request_id, message:'The callback request has been recorded for the salon team.' } }}", [-800, 760]));

  connect(connections,"Check Availability","Load Availability Tenant Config");
  connect(connections,"Load Availability Tenant Config","Prepare Availability Query");
  connect(connections,"Prepare Availability Query","Availability Request Valid?");
  connect(connections,"Availability Request Valid?","Check Google Calendar Free Busy",0);
  connect(connections,"Availability Request Valid?","Return Availability Error",1);
  connect(connections,"Check Google Calendar Free Busy","Choose Slot or Alternatives");
  connect(connections,"Choose Slot or Alternatives","Return Availability");
  connect(connections,"Find Appointment","Find Upcoming Appointments");
  connect(connections,"Find Upcoming Appointments","Format Upcoming Appointments");
  connect(connections,"Format Upcoming Appointments","Return Upcoming Appointments");
  connect(connections,"Log Complaint","Normalise Complaint");
  connect(connections,"Normalise Complaint","Persist Complaint Before Alert");
  connect(connections,"Persist Complaint Before Alert","Prepare Owner Alert");
  connect(connections,"Prepare Owner Alert","Owner Alert Transport Live?");
  connect(connections,"Owner Alert Transport Live?","Send Owner Complaint Alert",0);
  connect(connections,"Owner Alert Transport Live?","LOUD STUB Owner Complaint Alert",1);
  connect(connections,"Send Owner Complaint Alert","Record Owner Alert");
  connect(connections,"LOUD STUB Owner Complaint Alert","Record Owner Alert");
  connect(connections,"Record Owner Alert","Acknowledge Complaint");
  connect(connections,"Log Callback","Persist Callback Request");
  connect(connections,"Persist Callback Request","Acknowledge Callback");
  return workflow("WA AIOS - Retell Supporting Tools",nodes,connections);
}

const quietProcessorCode = `${swissCalendarHelpers}
const now = new Date();
return $input.all().map(item => {
  const j = item.json;
  const quiet = typeof j.quiet_hours === 'string' ? JSON.parse(j.quiet_hours) : j.quiet_hours;
  const messaging = typeof j.messaging_config === 'string' ? JSON.parse(j.messaging_config) : j.messaging_config;
  const quietNow = isQuiet(now, j.timezone, quiet);
  let action = 'send', deferredUntil = null;
  if (quietNow && j.template_id === 'appointment_t_2h') action = 'drop';
  else if (quietNow) {
    action = 'defer';
    const p = parts(now, j.timezone), [eh,em] = quiet.end.split(':').map(Number);
    const current = Number(p.hour)*60+Number(p.minute), target=eh*60+em;
    const minutes = current < target ? target-current : (1440-current)+target;
    deferredUntil = new Date(now.getTime()+minutes*60000).toISOString();
  }
  const body = j.body || ('Reminder: ' + j.service + ' with ' + j.staff + ' at ' + new Date(j.starts_at).toLocaleString('de-CH',{timeZone:j.timezone}));
  return {json:{...j, messaging, action, deferredUntil, body, transportPayload:{tenantId:j.tenant_id,channel:j.channel,to:j.recipient,templateId:j.template_id,body}}};
});`;

const recoveryProcessorCode = `${swissCalendarHelpers}
const now = new Date();
return $input.all().map(item => {
  const j = item.json;
  const quiet = typeof j.quiet_hours === 'string' ? JSON.parse(j.quiet_hours) : j.quiet_hours;
  const messaging = typeof j.messaging_config === 'string' ? JSON.parse(j.messaging_config) : j.messaging_config;
  const quietNow = isQuiet(now, j.timezone, quiet);
  let action = quietNow ? 'defer' : 'send', deferredUntil = null;
  if (quietNow) {
    const p = parts(now, j.timezone), [eh,em] = quiet.end.split(':').map(Number);
    const current = Number(p.hour)*60+Number(p.minute), target=eh*60+em;
    const minutes = current < target ? target-current : (1440-current)+target;
    deferredUntil = new Date(now.getTime()+minutes*60000).toISOString();
  }
  const opening = j.inferred ? 'It looks like we may have missed you. ' : 'We missed you. ';
  const body = opening + 'Reply to rebook your ' + j.service + ' appointment.';
  return {json:{...j,messaging,action,deferredUntil,body,transportPayload:{tenantId:j.tenant_id,channel:j.channel,to:j.recipient,templateId:j.template_id,body}}};
});`;

function buildReminderWorkflow() {
  const nodes = [];
  const connections = {};
  nodes.push(schedule("Every 5 Minutes", 5, [-980, 0]));
  nodes.push(postgres("Find Due Reminders", `with original as (
  select a.tenant_id::text, a.id::text as appointment_id, a.contact_id::text, a.starts_at, a.service, a.staff,
         t.timezone, t.quiet_hours, t.messaging_config,
         step.template_id, step.channel,
         case when step.channel='email' then c.email else c.phone_e164 end as recipient,
         step.due_at
  from appointments a join contacts c on c.id=a.contact_id join tenants t on t.id=a.tenant_id
  cross join lateral (values
    ('appointment_t_48h','whatsapp',a.starts_at-interval '48 hours'),
    ('appointment_t_24h','email',a.starts_at-interval '24 hours'),
    ('appointment_t_2h','whatsapp',a.starts_at-interval '2 hours')
  ) step(template_id,channel,due_at)
  where a.status='booked' and step.due_at between now()-interval '5 minutes' and now()
    and ((step.channel='whatsapp' and c.whatsapp_consent) or (step.channel='email' and c.email_consent))
    and not exists (select 1 from messages m where m.appointment_id=a.id and m.template_id=step.template_id)
    and not exists (select 1 from sequence_runs sr where sr.appointment_id=a.id and sr.sequence_type='appointment_reminder' and sr.current_step=step.template_id and sr.status='active')
), deferred as (
  select sr.tenant_id::text, sr.appointment_id::text, sr.contact_id::text, a.starts_at, a.service, a.staff,
         t.timezone, t.quiet_hours, t.messaging_config, sr.current_step as template_id,
         sr.metadata->>'channel' as channel, sr.metadata->>'recipient' as recipient, sr.next_fire_at as due_at
  from sequence_runs sr join appointments a on a.id=sr.appointment_id join tenants t on t.id=sr.tenant_id
  where sr.sequence_type='appointment_reminder' and sr.status='active' and sr.next_fire_at between now()-interval '5 minutes' and now()
), candidates as (
  select * from original union all select * from deferred
)
select * from candidates`, null, [-760, 0], { alwaysOutputData: true }));
  nodes.push(code("Apply Quiet Hours", quietProcessorCode, [-540, 0]));
  nodes.push(ifNode("Reminder Can Send?", "={{ $json.action }}", stringEquals, "send", [-320, 0]));
  nodes.push(ifNode("Reminder Is T2 Drop?", "={{ $json.action }}", stringEquals, "drop", [-100, 180]));
  nodes.push(ifNode("Messaging Transport Live?", "={{ $json.messaging.mode }}", stringEquals, "live", [-100, -100]));
  nodes.push(httpTransport("Send via Messaging Adapter", [120, -180]));
  nodes.push(code("LOUD STUB Reminder Send", `console.warn('[WA AIOS STUB] Outbound transport is disabled. Would send:', JSON.stringify($json.transportPayload)); return $input.all().map(i=>({json:{...i.json,delivery_status:'stubbed'}}));`, [120, -20]));
  const logQuery = `with message_row as (
  insert into messages (tenant_id,contact_id,appointment_id,channel,direction,body,template_id,delivery_status,sent_at)
  values ($1::uuid,$2::uuid,$3::uuid,$4,'outbound',$5,$6,$7,now()) returning id
), completed as (
  update sequence_runs set status='completed',exit_reason='sent',next_fire_at=null
  where appointment_id=$3::uuid and sequence_type='appointment_reminder' and current_step=$6 and status='active'
)
select id::text from message_row`;
  const logReplacements = "={{ [$('Apply Quiet Hours').item.json.tenant_id,$('Apply Quiet Hours').item.json.contact_id,$('Apply Quiet Hours').item.json.appointment_id,$('Apply Quiet Hours').item.json.channel,$('Apply Quiet Hours').item.json.body,$('Apply Quiet Hours').item.json.template_id,$json.delivery_status || 'sent'] }}";
  nodes.push(postgres("Log Reminder Send", logQuery, logReplacements, [360, -100]));
  nodes.push(postgres("Log Dropped T2 Reminder", `insert into messages (tenant_id,contact_id,appointment_id,channel,direction,body,template_id,delivery_status)
values ($1::uuid,$2::uuid,$3::uuid,$4,'outbound',$5,$6,'dropped_quiet_hours') returning id::text`, "={{ [$json.tenant_id,$json.contact_id,$json.appointment_id,$json.channel,$json.body,$json.template_id] }}", [120, 120]));
  nodes.push(postgres("Defer Reminder to Open Window", `insert into sequence_runs (tenant_id,contact_id,appointment_id,sequence_type,status,current_step,next_fire_at,metadata)
values ($1::uuid,$2::uuid,$3::uuid,'appointment_reminder','active',$4,$5::timestamptz,$6::jsonb) returning id::text`, "={{ [$json.tenant_id,$json.contact_id,$json.appointment_id,$json.template_id,$json.deferredUntil,JSON.stringify({channel:$json.channel,recipient:$json.recipient,body:$json.body})] }}", [120, 260]));

  connect(connections,"Every 5 Minutes","Find Due Reminders");
  connect(connections,"Find Due Reminders","Apply Quiet Hours");
  connect(connections,"Apply Quiet Hours","Reminder Can Send?");
  connect(connections,"Reminder Can Send?","Messaging Transport Live?",0);
  connect(connections,"Reminder Can Send?","Reminder Is T2 Drop?",1);
  connect(connections,"Messaging Transport Live?","Send via Messaging Adapter",0);
  connect(connections,"Messaging Transport Live?","LOUD STUB Reminder Send",1);
  connect(connections,"Send via Messaging Adapter","Log Reminder Send");
  connect(connections,"LOUD STUB Reminder Send","Log Reminder Send");
  connect(connections,"Reminder Is T2 Drop?","Log Dropped T2 Reminder",0);
  connect(connections,"Reminder Is T2 Drop?","Defer Reminder to Open Window",1);
  return workflow("WA AIOS - Appointment Reminders",nodes,connections);
}

function buildNoShowWorkflow() {
  const nodes=[]; const connections={};
  nodes.push(schedule("Every 10 Minutes",10,[-980,0]));
  nodes.push(postgres("Find Due No-show Steps", `with original as (
select a.tenant_id::text,a.id::text appointment_id,a.contact_id::text,a.service,a.staff,t.timezone,t.quiet_hours,t.messaging_config,
  step.template_id,step.channel,case when step.channel='email' then c.email else c.phone_e164 end recipient,step.due_at,
  (a.status_source='inferred') as inferred
from appointments a join contacts c on c.id=a.contact_id join tenants t on t.id=a.tenant_id
cross join lateral (values
 ('no_show_30m','whatsapp',a.starts_at+interval '30 minutes'),
 ('no_show_day1','email',a.starts_at+interval '1 day'),
 ('no_show_day3','whatsapp',a.starts_at+interval '3 days'),
 ('no_show_day7','none',a.starts_at+interval '7 days')
) step(template_id,channel,due_at)
where a.status='no_show' and step.due_at between now()-interval '10 minutes' and now()
and ((step.channel='whatsapp' and c.whatsapp_consent) or (step.channel='email' and c.email_consent) or step.channel='none')
and not exists(select 1 from appointments r where r.recovered_from_no_show_id=a.id)
and not exists(select 1 from messages m where m.appointment_id=a.id and m.template_id=step.template_id)
and not exists(select 1 from sequence_runs sr where sr.appointment_id=a.id and sr.sequence_type='no_show_recovery' and sr.current_step=step.template_id and sr.status='active')
), deferred as (
 select sr.tenant_id::text,sr.appointment_id::text,sr.contact_id::text,a.service,a.staff,t.timezone,t.quiet_hours,t.messaging_config,
        sr.current_step as template_id,sr.metadata->>'channel' as channel,sr.metadata->>'recipient' as recipient,sr.next_fire_at as due_at,
        (a.status_source='inferred') as inferred
 from sequence_runs sr join appointments a on a.id=sr.appointment_id join tenants t on t.id=sr.tenant_id
 where sr.sequence_type='no_show_recovery' and sr.status='active' and sr.next_fire_at between now()-interval '10 minutes' and now()
 and not exists(select 1 from appointments r where r.recovered_from_no_show_id=a.id)
)
select * from original union all select * from deferred`,null,[-760,0],{alwaysOutputData:true}));
  nodes.push(code("Prepare Recovery Step", recoveryProcessorCode,[-540,0]));
  nodes.push(ifNode("Move to Re-engagement?","={{ $json.template_id }}",stringEquals,"no_show_day7",[-320,0]));
  nodes.push(postgres("Start Re-engagement",`insert into sequence_runs (tenant_id,contact_id,appointment_id,sequence_type,status,current_step,next_fire_at,metadata)
values ($1::uuid,$2::uuid,$3::uuid,'re_engagement','active','start',now(),jsonb_build_object('origin','no_show_day7')) returning id::text`,"={{ [$json.tenant_id,$json.contact_id,$json.appointment_id] }}",[-100,-120]));
  nodes.push(ifNode("Recovery Can Send?","={{ $json.action }}",stringEquals,"send",[-100,80]));
  nodes.push(ifNode("Recovery Transport Live?","={{ $json.messaging.mode }}",stringEquals,"live",[120,0]));
  nodes.push(httpTransport("Send Recovery via Adapter",[340,-80]));
  nodes.push(code("LOUD STUB Recovery Send",`console.warn('[WA AIOS STUB] Would send recovery:',JSON.stringify($json.transportPayload)); return $input.all().map(i=>({json:{...i.json,delivery_status:'stubbed'}}));`,[340,80]));
  nodes.push(postgres("Log Recovery Message",`with message_row as (
 insert into messages (tenant_id,contact_id,appointment_id,channel,direction,body,template_id,delivery_status,sent_at)
 values($1::uuid,$2::uuid,$3::uuid,$4,'outbound',$5,$6,$7,now()) returning id
), completed as (
 update sequence_runs set status='completed',exit_reason='sent',next_fire_at=null
 where appointment_id=$3::uuid and sequence_type='no_show_recovery' and current_step=$6 and status='active'
)
select id::text from message_row`,"={{ [ $('Prepare Recovery Step').item.json.tenant_id,$('Prepare Recovery Step').item.json.contact_id,$('Prepare Recovery Step').item.json.appointment_id,$('Prepare Recovery Step').item.json.channel,$('Prepare Recovery Step').item.json.body,$('Prepare Recovery Step').item.json.template_id,$json.delivery_status||'sent' ] }}",[560,0]));
  nodes.push(postgres("Defer Recovery Step",`insert into sequence_runs (tenant_id,contact_id,appointment_id,sequence_type,status,current_step,next_fire_at,metadata)
values($1::uuid,$2::uuid,$3::uuid,'no_show_recovery','active',$4,$5::timestamptz,$6::jsonb) returning id::text`,"={{ [$json.tenant_id,$json.contact_id,$json.appointment_id,$json.template_id,$json.deferredUntil,JSON.stringify({channel:$json.channel,recipient:$json.recipient,body:$json.body})] }}",[120,180]));
  connect(connections,"Every 10 Minutes","Find Due No-show Steps");
  connect(connections,"Find Due No-show Steps","Prepare Recovery Step");
  connect(connections,"Prepare Recovery Step","Move to Re-engagement?");
  connect(connections,"Move to Re-engagement?","Start Re-engagement",0);
  connect(connections,"Move to Re-engagement?","Recovery Can Send?",1);
  connect(connections,"Recovery Can Send?","Recovery Transport Live?",0);
  connect(connections,"Recovery Can Send?","Defer Recovery Step",1);
  connect(connections,"Recovery Transport Live?","Send Recovery via Adapter",0);
  connect(connections,"Recovery Transport Live?","LOUD STUB Recovery Send",1);
  connect(connections,"Send Recovery via Adapter","Log Recovery Message");
  connect(connections,"LOUD STUB Recovery Send","Log Recovery Message");
  return workflow("WA AIOS - No-show Recovery",nodes,connections);
}

function buildReviewWorkflow() {
  const nodes=[]; const connections={};
  nodes.push(schedule("Every 10 Minutes Review Requests",10,[-980,-220]));
  nodes.push(postgres("Find Due Review Requests",`with original as (
select a.tenant_id::text,a.id::text appointment_id,a.contact_id::text,a.service,c.phone_e164 recipient,
 t.timezone,t.quiet_hours,t.messaging_config,t.review_config
from appointments a join contacts c on c.id=a.contact_id join tenants t on t.id=a.tenant_id
where a.status='completed'
and a.ends_at + ((t.review_config->>'delayHours')::int * interval '1 hour') between now()-interval '10 minutes' and now()
and c.whatsapp_consent
and not exists(select 1 from reviews r where r.appointment_id=a.id)
and not exists(select 1 from sequence_runs sr where sr.appointment_id=a.id and sr.sequence_type='review_request' and sr.status='active')
), deferred as (
 select sr.tenant_id::text,sr.appointment_id::text,sr.contact_id::text,a.service,c.phone_e164 recipient,
        t.timezone,t.quiet_hours,t.messaging_config,t.review_config
 from sequence_runs sr join appointments a on a.id=sr.appointment_id join contacts c on c.id=sr.contact_id join tenants t on t.id=sr.tenant_id
 where sr.sequence_type='review_request' and sr.status='active' and sr.next_fire_at between now()-interval '10 minutes' and now()
)
select * from original union all select * from deferred`,null,[-760,-220],{alwaysOutputData:true}));
  nodes.push(code("Prepare Review Request", `${swissCalendarHelpers}
const now=new Date(); return $input.all().map(i=>{const j=i.json, q=typeof j.quiet_hours==='string'?JSON.parse(j.quiet_hours):j.quiet_hours, m=typeof j.messaging_config==='string'?JSON.parse(j.messaging_config):j.messaging_config; const quiet=isQuiet(now,j.timezone,q); const body='How was your visit? Reply with a rating from 1 to 5.'; return {json:{...j,messaging:m,action:quiet?'defer':'send',body,template_id:'review_rating_request',channel:'whatsapp',transportPayload:{tenantId:j.tenant_id,channel:'whatsapp',to:j.recipient,templateId:'review_rating_request',body}}};});`,[-540,-220]));
  nodes.push(ifNode("Review Request Can Send?","={{ $json.action }}",stringEquals,"send",[-320,-220]));
  nodes.push(ifNode("Review Transport Live?","={{ $json.messaging.mode }}",stringEquals,"live",[-100,-300]));
  nodes.push(httpTransport("Send Review Request via Adapter",[120,-380]));
  nodes.push(code("LOUD STUB Review Request",`console.warn('[WA AIOS STUB] Would request review:',JSON.stringify($json.transportPayload)); return $input.all().map(i=>({json:{...i.json,delivery_status:'stubbed'}}));`,[120,-220]));
  nodes.push(postgres("Create Review and Log Request",`with review_row as (
 insert into reviews(tenant_id,contact_id,appointment_id,requested_at) values($1::uuid,$2::uuid,$3::uuid,now()) returning id
), message_row as (
 insert into messages(tenant_id,contact_id,appointment_id,channel,direction,body,template_id,delivery_status,sent_at)
 values($1::uuid,$2::uuid,$3::uuid,'whatsapp','outbound',$4,'review_rating_request',$5,now())
), completed as (
 update sequence_runs set status='completed',exit_reason='sent',next_fire_at=null
 where appointment_id=$3::uuid and sequence_type='review_request' and status='active'
)
select id::text from review_row`,"={{ [ $('Prepare Review Request').item.json.tenant_id,$('Prepare Review Request').item.json.contact_id,$('Prepare Review Request').item.json.appointment_id,$('Prepare Review Request').item.json.body,$json.delivery_status||'sent' ] }}",[340,-300]));
  nodes.push(postgres("Defer Review Request",`insert into sequence_runs(tenant_id,contact_id,appointment_id,sequence_type,status,current_step,next_fire_at,metadata)
values($1::uuid,$2::uuid,$3::uuid,'review_request','active','rating_request',((date_trunc('day',now() at time zone $4)+interval '1 day 8 hours') at time zone $4),jsonb_build_object('quiet_hours_deferred',true)) returning id::text`,"={{ [$json.tenant_id,$json.contact_id,$json.appointment_id,$json.timezone] }}",[-100,-120]));

  nodes.push(webhook("Receive Rating","review-rating",[-980,220]));
  nodes.push(postgres("Load Review Gate",`select r.id::text review_id,r.tenant_id::text,r.contact_id::text,r.appointment_id::text,t.review_config,t.messaging_config,t.quiet_hours,t.timezone
from reviews r join tenants t on t.id=r.tenant_id where r.tenant_id=$1::uuid and r.appointment_id=$2::uuid limit 1`,"={{ [$json.body.tenant_id,$json.body.appointment_id] }}",[-760,220]));
  nodes.push(code("Apply Rating Gate", `${swissCalendarHelpers}
const j=$input.first().json,b=$('Receive Rating').first().json.body||{},cfg=typeof j.review_config==='string'?JSON.parse(j.review_config):j.review_config;
const rating=Math.max(1,Math.min(5,Number(b.rating))), publicRoute=!cfg.gateEnabled||rating>=Number(cfg.threshold||4);
return [{json:{...j,rating,publicRoute,route:publicRoute?'google':'private',link:publicRoute?cfg.googleReviewUrl:cfg.privateFeedbackUrl,feedback:String(b.feedback||''),ownerEmail:cfg.ownerAlertEmail,quiet:isQuiet(new Date(),j.timezone,typeof j.quiet_hours==='string'?JSON.parse(j.quiet_hours):j.quiet_hours)}}];`,[-540,220]));
  nodes.push(postgres("Save Rating",`update reviews set rating=$2::int,routed_to=$3,received_at=now(),private_feedback=nullif($4,'') where id=$1::uuid returning id::text`,"={{ [$json.review_id,$json.rating,$json.route,$json.feedback] }}",[-320,220]));
  nodes.push(ifNode("Public Review Route?","={{ $('Apply Rating Gate').first().json.publicRoute }}",booleanTrue,true,[-100,220]));
  nodes.push(respond("Return Google Review Link","={{ { status:'received', routedTo:'google', link:$('Apply Rating Gate').first().json.link } }}",[120,120]));
  nodes.push(postgres("Create Private Feedback Alert",`with complaint_row as (
 insert into complaints(tenant_id,contact_id,source_channel,detected_category,severity,body,notified_at)
 values($1::uuid,$2::uuid,'review','low_rating','high',$3,case when $4::boolean then null else now() end) returning id
), message_row as (
 insert into messages(tenant_id,contact_id,appointment_id,channel,direction,body,template_id,delivery_status,sent_at)
 values($1::uuid,$2::uuid,$5::uuid,'email','outbound',$6,'owner_low_rating_alert',case when $4::boolean then 'queued' else 'stubbed' end,case when $4::boolean then null else now() end)
)
select id::text from complaint_row`,"={{ [ $('Apply Rating Gate').first().json.tenant_id,$('Apply Rating Gate').first().json.contact_id,$('Apply Rating Gate').first().json.feedback,$('Apply Rating Gate').first().json.quiet,$('Apply Rating Gate').first().json.appointment_id,'[WA AIOS] Low rating received. Owner alert transport is ' + ($('Apply Rating Gate').first().json.quiet?'deferred for quiet hours.':'stubbed until configured.') ] }}",[120,300]));
  nodes.push(respond("Return Private Feedback Link","={{ { status:'received', routedTo:'private', link:$('Apply Rating Gate').first().json.link, ownerAlert:$('Apply Rating Gate').first().json.quiet?'deferred_quiet_hours':'stubbed' } }}",[340,300]));

  connect(connections,"Every 10 Minutes Review Requests","Find Due Review Requests");
  connect(connections,"Find Due Review Requests","Prepare Review Request");
  connect(connections,"Prepare Review Request","Review Request Can Send?");
  connect(connections,"Review Request Can Send?","Review Transport Live?",0);
  connect(connections,"Review Request Can Send?","Defer Review Request",1);
  connect(connections,"Review Transport Live?","Send Review Request via Adapter",0);
  connect(connections,"Review Transport Live?","LOUD STUB Review Request",1);
  connect(connections,"Send Review Request via Adapter","Create Review and Log Request");
  connect(connections,"LOUD STUB Review Request","Create Review and Log Request");
  connect(connections,"Receive Rating","Load Review Gate");
  connect(connections,"Load Review Gate","Apply Rating Gate");
  connect(connections,"Apply Rating Gate","Save Rating");
  connect(connections,"Save Rating","Public Review Route?");
  connect(connections,"Public Review Route?","Return Google Review Link",0);
  connect(connections,"Public Review Route?","Create Private Feedback Alert",1);
  connect(connections,"Create Private Feedback Alert","Return Private Feedback Link");
  return workflow("WA AIOS - Review Requests and Rating Gate",nodes,connections);
}

function buildCallLogWorkflow(){
  const nodes=[]; const connections={};
  nodes.push(webhook("Retell Call Completed","log-call",[-820,0]));
  nodes.push(code("Normalise Call Summary", `const request=$input.first().json,body=request.body||{}; const raw=String(body.outcome||'question_answered'); const outcome=({booked:'booked',rescheduled:'rescheduled',cancelled:'cancelled',transferred:'transferred',complaint:'transferred',callback_requested:'transferred',abandoned:'missed',question_answered:'inquiry'})[raw]||'inquiry'; return [{json:{tenantId:body.tenantId||body.tenant_id||(request.query||{}).tenantId||$env.TENANT_ID,customerName:String(body.customerName||'Caller'),customerPhone:String(body.customerPhone||''),callId:String(body.callId||$execution.id),startedAt:body.startedAt||new Date().toISOString(),durationSeconds:Number(body.durationSeconds||0),answered:body.answered!==false,outcome,summary:String(body.summary||''),recordingUrl:String(body.recordingUrl||''),disclosurePlayed:body.disclosurePlayed===true||body.disclosure_played===true}}];`,[-600,0]));
  nodes.push(postgres("Persist Call and Audit Event",`with contact_row as (
 insert into contacts(tenant_id,first_name,phone_e164,source)
 values($1::uuid,coalesce(nullif($2,''),'Caller'),nullif($3,''),'call')
 on conflict(tenant_id,phone_e164) do update set updated_at=now() returning id
), call_row as (
 insert into calls(tenant_id,contact_id,retell_call_id,started_at,duration_seconds,answered,outcome,transcript,recording_url,disclosure_played)
 select $1::uuid,id,$4,$5::timestamptz,$6::int,$7::boolean,$8,nullif($9,''),nullif($10,''),$11::boolean from contact_row
 on conflict(tenant_id,retell_call_id) do update set duration_seconds=excluded.duration_seconds,outcome=excluded.outcome,transcript=excluded.transcript,recording_url=excluded.recording_url,disclosure_played=excluded.disclosure_played
 returning *
), audit_row as (
 insert into events(tenant_id,aggregate_type,aggregate_id,event_type,source,payload)
 select tenant_id,'call',id,'call.completed','retell',jsonb_build_object('outcome',outcome,'disclosure_played',disclosure_played) from call_row
)
select id::text,disclosure_played from call_row`,"={{ [ $json.tenantId,$json.customerName,$json.customerPhone,$json.callId,$json.startedAt,$json.durationSeconds,$json.answered,$json.outcome,$json.summary,$json.recordingUrl,$json.disclosurePlayed ] }}",[-360,0]));
  nodes.push(respond("Acknowledge Call Log","={{ { logged:true, callId:$json.id, complianceFlag:$json.disclosure_played?null:'recording_disclosure_missing' } }}",[-120,0]));
  connect(connections,"Retell Call Completed","Normalise Call Summary");
  connect(connections,"Normalise Call Summary","Persist Call and Audit Event");
  connect(connections,"Persist Call and Audit Event","Acknowledge Call Log");
  return workflow("WA AIOS - Retell Call Logging",nodes,connections);
}

const outputs = [
  ["booking-google-calendar.json", buildBookingWorkflow()],
  ["retell-tools.json", buildRetellToolsWorkflow()],
  ["appointment-reminders.json", buildReminderWorkflow()],
  ["no-show-recovery.json", buildNoShowWorkflow()],
  ["review-reputation.json", buildReviewWorkflow()],
  ["call-logging.json", buildCallLogWorkflow()]
];

for (const [filename, data] of outputs) {
  await writeFile(path.join(here, filename), JSON.stringify(data, null, 2) + "\n");
  console.log(`Wrote workflows/${filename}`);
}
