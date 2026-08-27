import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { KpiDay, Tenant } from "./types";

export type Source = "api" | "snapshot";
export type Live = { upcoming_appointments: number; today_appointments: number; open_leads: number; open_complaints: number; queued_messages: number; calls_7d: number };
export type Appointment = { id: string; status: string; status_source: string; starts_at: string; ends_at: string; service: string; value_chf: number; staff: string; lead_source: string | null; recovered_from_no_show_id: string | null; first_name: string; last_name: string | null; phone_e164: string | null; email: string | null };
export type Call = { id: string; retell_call_id: string; started_at: string; duration_seconds: number; answered: boolean; outcome: string | null; disclosure_played: boolean; transcript: string | null; recording_url: string | null; first_name: string | null; phone_e164: string | null };
export type Lead = { id: string; source: string; channel: string | null; service_interest: string | null; urgency: string; preferred_time: string | null; notes: string | null; status: string; booked_appointment_id: string | null; created_at: string; updated_at: string; contact_id: string; first_name: string; last_name: string | null; phone_e164: string | null; email: string | null; manychat_subscriber_id: string | null; follow_ups_sent: number; next_follow_up_at: string | null };
export type Funnel = { status: string; count: number }[];
export type Review = { id: string; requested_at: string; rating: number | null; routed_to: string | null; received_at: string | null; gbp_review_id: string | null; private_feedback: string | null; first_name: string | null; service: string | null; staff: string | null };
export type Complaint = { id: string; source_channel: string; detected_category: string | null; severity: string; body: string; notified_at: string | null; resolved_at: string | null; created_at: string; first_name: string | null; phone_e164: string | null };
export type Message = { id: string; channel: string; direction: string; body: string; template_id: string | null; delivery_status: string; scheduled_for: string | null; sent_at: string | null; created_at: string; first_name: string | null; phone_e164: string | null; email: string | null };

const API = (process.env.AIOS_API_URL || "").replace(/\/$/, "");
const TOKEN = process.env.DASHBOARD_API_TOKEN || "";
const TENANT = process.env.NEXT_PUBLIC_DEMO_TENANT_ID || "";
export const connected = Boolean(API && TOKEN);
export const source: Source = connected ? "api" : "snapshot";

type Snapshot = {
  generatedAt: string; tenant: Tenant; kpis: KpiDay[]; live: Live;
  appointments: { upcoming: Appointment[]; past: Appointment[] };
  calls: Call[]; leads: Lead[]; funnel: Funnel; reviews: Review[]; complaints: Complaint[]; messages: Message[];
};

let snapshotCache: Promise<Snapshot> | null = null;
function snapshot(): Promise<Snapshot> {
  snapshotCache ??= readFile(path.join(process.cwd(), "data", "seed-dashboard.json"), "utf8").then((raw) => JSON.parse(raw) as Snapshot);
  return snapshotCache;
}

function normalizeKpi(row: Record<string, unknown>): KpiDay {
  const out = { ...row } as Record<string, unknown>;
  for (const [k, v] of Object.entries(row)) if (k !== "kpi_date" && k !== "average_rating") out[k] = Number(v || 0);
  out.average_rating = row.average_rating == null ? null : Number(row.average_rating);
  out.kpi_date = String(row.kpi_date).slice(0, 10);
  return out as KpiDay;
}

async function api<T>(pathname: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const url = new URL(`${API}/api/dashboard/${pathname}`);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  if (TENANT) url.searchParams.set("tenantId", TENANT);
  const res = await fetch(url, { headers: { authorization: `Bearer ${TOKEN}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`AIOS API ${pathname} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

export async function getOverview() {
  if (connected) {
    const o = await api<{ tenant: Tenant; kpis: Record<string, unknown>[]; live: Live; generatedAt: string }>("overview");
    return { source, tenant: o.tenant, kpis: o.kpis.map(normalizeKpi), live: o.live, generatedAt: o.generatedAt };
  }
  const s = await snapshot();
  return { source, tenant: s.tenant, kpis: s.kpis.map((k) => normalizeKpi(k as unknown as Record<string, unknown>)), live: s.live, generatedAt: s.generatedAt };
}
export async function getTenant(): Promise<Tenant> { return (await getOverview()).tenant; }
export async function getAppointments(scope: "upcoming" | "past") {
  if (connected) return (await api<{ appointments: Appointment[] }>("appointments", { scope: scope === "past" ? "past" : undefined, limit: "200" })).appointments;
  return (await snapshot()).appointments[scope];
}
export async function getCalls() {
  if (connected) return (await api<{ calls: Call[] }>("calls", { limit: "200" })).calls;
  return (await snapshot()).calls;
}
export async function getLeads(status?: string) {
  if (connected) return api<{ leads: Lead[]; funnel: Funnel }>("leads", { status, limit: "200" });
  const s = await snapshot();
  return { leads: status ? s.leads.filter((l) => l.status === status) : s.leads, funnel: s.funnel };
}
export async function getReviews() {
  if (connected) return api<{ reviews: Review[]; complaints: Complaint[] }>("reviews", { limit: "200" });
  const s = await snapshot();
  return { reviews: s.reviews, complaints: s.complaints };
}
export async function getMessages() {
  if (connected) return (await api<{ messages: Message[] }>("messages", { limit: "200" })).messages;
  return (await snapshot()).messages;
}

/** Writes go through the same webhook the receptionist uses, with the shared secret. */
export async function updateLeadStatus(leadId: string, status: string, notes?: string) {
  if (!connected) throw new Error("Demo-Modus: Änderungen sind erst möglich, wenn die API verbunden ist (AIOS_API_URL).");
  const secret = process.env.RETELL_WEBHOOK_SECRET || "";
  const res = await fetch(`${API}/webhook/lead-status`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-retell-webhook-secret": secret } : {}) },
    body: JSON.stringify({ leadId, status, notes, ...(TENANT ? { tenantId: TENANT } : {}) }),
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`Status konnte nicht gesetzt werden (HTTP ${res.status}).`);
  return res.json();
}
