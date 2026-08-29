import Link from "next/link";
import { getOverview } from "../../lib/api";
import { calculateMetrics } from "../../lib/metrics";
import { fmt, label } from "../../lib/format";
import { Card, PageHead, Stat, BarList, Badge, Empty } from "../../lib/ui";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = { call: "Phone", instagram: "Instagram", whatsapp: "WhatsApp", website: "Website", google: "Google" };

function activityText(row: { event_type: string; payload: Record<string, unknown>; first_name: string; last_name: string }) {
  const who = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  const map: Record<string, string> = {
    "appointment.created": "Appointment booked",
    "appointment.cancelled": "Appointment cancelled",
    "appointment.completed_inferred": "Appointment completed",
    "appointment.no_show": "Marked no-show",
    "lead.created": `New ${String(row.payload.channel || row.payload.source || "lead")} lead`,
    "call.call_analyzed": `Call — ${label(String(row.payload.outcome || "inquiry"))}`,
    "complaint.created": "Complaint logged",
    "callback.requested": "Callback requested"
  };
  return { title: map[row.event_type] || label(row.event_type), who };
}

export default async function OverviewPage() {
  const data = await getOverview();
  const m = calculateMetrics(data.kpis);
  const live = data.live;
  const sources = (Object.entries(m.bySource) as [string, { leads: number; bookings: number; conversion: number }][])
    .filter(([, v]) => v.leads > 0 || v.bookings > 0);

  const latestRating = [...m.ratingTrend].reverse().find((p) => p.value !== null)?.value ?? null;
  const attention: { label: string; href: string; count: number }[] = [
    { label: "Conversations need a human", href: "/inbox", count: live.conversations_need_human || 0 },
    { label: "Open complaints", href: "/customers", count: live.open_complaints || 0 },
    { label: "Open leads", href: "/leads", count: live.open_leads || 0 }
  ].filter((a) => a.count > 0);

  return (
    <>
      <PageHead title={`Good day, ${data.tenant.name}`} lede="What your AI receptionist and automations are doing right now." />

      <div className="kpi-hero" style={{ marginBottom: 14 }}>
        <div className="hero-panel">
          <span className="eyebrow">Booked revenue ahead</span>
          <div className="big">{fmt.chf(live.upcoming_revenue_chf || 0)}</div>
          <p className="muted" style={{ margin: "6px 0 20px", maxWidth: "36ch" }}>
            Confirmed appointments the receptionist has already booked into the calendar.
          </p>
          <div className="row" style={{ gap: 10 }}>
            <div className="chip" style={{ padding: "8px 12px", fontSize: 13 }}><b>{fmt.int(live.upcoming_appointments)}</b>&nbsp;upcoming</div>
            <div className="chip" style={{ padding: "8px 12px", fontSize: 13 }}><b>{fmt.int(live.today_appointments)}</b>&nbsp;today</div>
            <div className="chip" style={{ padding: "8px 12px", fontSize: 13 }}><b>{fmt.int(m.callsAnswered)}</b>&nbsp;calls answered this month</div>
          </div>
        </div>
        <div className="grid cols-2">
          <Stat k="Bookings · month to date" v={fmt.int(m.bookingsCurrent)}
            delta={m.bookingsChange === null ? undefined : { value: m.bookingsChange, suffix: "vs last month" }}
            foot={`Prev ${fmt.int(m.bookingsPrevious)}`} />
          <Stat k="Calls answered" v={fmt.pct(m.answeredRate)} foot={`${m.callsAnswered} of ${m.callsTotal}`} />
          <Stat k="No-show rate" v={fmt.pct(m.noShowRate)} foot={`${m.noShows} of ${m.appointmentsDue} due`} />
          <Stat k="Rating" v={latestRating ? latestRating.toFixed(1) : "—"} foot={`${m.reviewsReceived} reviews`} />
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Stat k="Customers" v={fmt.int(live.total_customers || 0)} />
        <Stat k="Open leads" v={fmt.int(live.open_leads)} />
        <Stat k="Messages queued" v={fmt.int(live.queued_messages)} />
        <Stat k="Calls · 7 days" v={fmt.int(live.calls_7d)} />
      </div>

      <div className="grid cols-2">
        <Card title="Recent activity" action={<Link className="btn sm ghost" href="/analytics">Analytics →</Link>}>
          {data.activity.length ? (
            <div className="timeline">
              {data.activity.map((row, i) => {
                const t = activityText(row);
                return (
                  <div className="tl-item" key={i}>
                    <div className="dotcol"><span className="tl-dot" />{i < data.activity.length - 1 ? <span className="tl-line" /> : null}</div>
                    <div className="tl-body">
                      {t.title}{t.who ? <span className="muted"> · {t.who}</span> : null}
                      <div className="tl-time">{fmt.rel(row.occurred_at)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <Empty>No activity recorded yet.</Empty>}
        </Card>

        <div className="stack">
          {attention.length ? (
            <Card title="Needs attention">
              <div className="stack" style={{ gap: 8 }}>
                {attention.map((a) => (
                  <Link key={a.href + a.label} href={a.href} className="spread" style={{ padding: "8px 0" }}>
                    <span>{a.label}</span>
                    <span className="badge warn">{a.count}</span>
                  </Link>
                ))}
              </div>
            </Card>
          ) : null}

          <Card title="Where leads come from" sub="This month">
            {sources.length ? (
              <BarList items={sources.map(([k, v]) => ({ label: SOURCE_LABEL[k] || k, value: v.leads, hint: `${v.leads} · ${fmt.pct(v.conversion)} booked` }))} />
            ) : <Empty>No leads this month yet.</Empty>}
          </Card>
        </div>
      </div>
    </>
  );
}
