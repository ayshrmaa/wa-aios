import type { ReactNode } from "react";

const dt = new Intl.DateTimeFormat("de-CH", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
const d = new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Zurich" });
export const fmt = {
  dateTime: (v: string | null | undefined) => (v ? dt.format(new Date(v)) : "—"),
  date: (v: string | null | undefined) => (v ? d.format(new Date(v)) : "—"),
  int: (v: number) => new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 }).format(v),
  chf: (v: number) => new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF", maximumFractionDigits: 0 }).format(v),
  duration: (s: number) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "—"),
  name: (first: string | null | undefined, last?: string | null) => [first, last].filter(Boolean).join(" ") || "Unbekannt"
};

const tones: Record<string, string> = {
  booked: "ok", completed: "ok", sent: "ok", delivered: "ok", google: "ok", qualified: "ok", answered: "ok",
  new: "info", contacted: "info", queued: "info", now: "warn", this_week: "info", flexible: "muted",
  no_show: "bad", failed: "bad", lost: "bad", private: "warn", missed: "bad", high: "bad", medium: "warn", low: "muted",
  cancelled: "muted", stubbed: "muted", dropped_quiet_hours: "muted", rescheduled: "info"
};
const labels: Record<string, string> = {
  booked: "Gebucht", completed: "Abgeschlossen", no_show: "No-show", cancelled: "Storniert",
  new: "Neu", contacted: "Kontaktiert", qualified: "Qualifiziert", lost: "Verloren",
  queued: "Geplant", sent: "Gesendet", delivered: "Zugestellt", failed: "Abgebrochen", stubbed: "Simuliert", dropped_quiet_hours: "Ruhezeit",
  now: "Sofort", this_week: "Diese Woche", flexible: "Flexibel", google: "Google", private: "Intern",
  high: "Hoch", medium: "Mittel", low: "Niedrig", answered: "Beantwortet", missed: "Verpasst",
  call: "Anruf", instagram: "Instagram", whatsapp: "WhatsApp", website: "Website", google_src: "Google", manual: "Manuell", email: "E-Mail", sms: "SMS",
  inquiry: "Anfrage", transferred: "Weitergeleitet", complaint: "Beschwerde", callback_requested: "Rückruf", abandoned: "Abgebrochen", question_answered: "Frage beantwortet"
};
export function Pill({ value, label }: { value: string | null | undefined; label?: string }) {
  const key = value ?? "";
  return <span className={`pill pill-${tones[key] ?? "muted"}`}>{label ?? labels[key] ?? key ?? "—"}</span>;
}
export function Channel({ value }: { value: string | null | undefined }) { return <span className="chip">{labels[value ?? ""] ?? value ?? "—"}</span>; }

export function PageHead({ title, lede, children }: { title: string; lede: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div><h1>{title}</h1><p>{lede}</p></div>
      {children ? <div className="page-head-actions">{children}</div> : null}
    </header>
  );
}
export function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }
