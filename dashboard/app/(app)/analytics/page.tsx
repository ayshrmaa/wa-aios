import Link from "next/link";
import { getAnalytics, connected } from "../../../lib/api";
import { fmt, CHANNEL_LABEL } from "../../../lib/format";
import { PageHead, Card, Stat, AreaChart, MiniBars, BarList, Offline } from "../../../lib/ui";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  if (!connected) return (<><PageHead title="Analytics" /><Offline what="Analytics" /></>);
  const days = Math.max(7, Math.min(365, Number((await searchParams).days || 90)));
  const { series, bySource, totals } = await getAnalytics(days);

  const revenuePts = series.map((p) => ({ label: p.date.slice(5), value: p.revenue }));
  const barSeries = series.map((p) => ({ Booked: p.booked, Completed: p.completed, "No-show": p.no_shows }));
  const leadConv = totals.leads ? (totals.leads_booked / totals.leads) * 100 : 0;
  const callConv = totals.calls ? (totals.calls_booked / totals.calls) * 100 : 0;
  const showRate = totals.completed + totals.no_shows ? (totals.completed / (totals.completed + totals.no_shows)) * 100 : 0;

  return (
    <>
      <PageHead title="Analytics" lede={`Performance over the last ${days} days.`}>
        <div className="seg">
          {[30, 90, 180, 365].map((d) => (
            <Link key={d} href={`/analytics?days=${d}`} className={days === d ? "active" : ""}>{d}d</Link>
          ))}
        </div>
      </PageHead>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Stat k="Revenue booked" v={fmt.chf(totals.revenue)} />
        <Stat k="Bookings" v={fmt.int(totals.bookings)} foot={`${fmt.int(totals.completed)} completed`} />
        <Stat k="Lead → booking" v={fmt.pct(leadConv)} foot={`${totals.leads} leads`} />
        <Stat k="Call → booking" v={fmt.pct(callConv)} foot={`${totals.calls} calls`} />
      </div>

      <div className="grid cols-2">
        <Card title="Revenue booked per day" sub={`Last ${days} days`}>
          <AreaChart points={revenuePts} valueFormat={(n) => fmt.chf(n)} height={170} />
        </Card>
        <Card title="Appointments per day" sub="Booked · completed · no-show">
          <MiniBars series={barSeries} keys={[{ name: "Booked", color: "var(--brand)" }, { name: "Completed", color: "var(--accent)" }, { name: "No-show", color: "var(--bad)" }]} height={170} />
          <div className="row" style={{ gap: 14, marginTop: 8, fontSize: 12 }}>
            <span className="row" style={{ gap: 5 }}><i style={{ width: 9, height: 9, background: "var(--brand)", borderRadius: 2 }} /> Booked</span>
            <span className="row" style={{ gap: 5 }}><i style={{ width: 9, height: 9, background: "var(--accent)", borderRadius: 2 }} /> Completed</span>
            <span className="row" style={{ gap: 5 }}><i style={{ width: 9, height: 9, background: "var(--bad)", borderRadius: 2 }} /> No-show</span>
          </div>
        </Card>

        <Card title="Leads by source" sub={`Last ${days} days`}>
          <BarList items={bySource.map((s) => ({ label: CHANNEL_LABEL[s.source] || s.source, value: s.leads, hint: `${s.leads} · ${s.booked} booked` }))} />
        </Card>

        <Card title="Operations">
          <div className="grid cols-2" style={{ gap: 10 }}>
            <Stat k="Show rate" v={fmt.pct(showRate)} foot={`${totals.no_shows} no-shows`} />
            <Stat k="Messages sent" v={fmt.int(totals.messages_sent)} />
            <Stat k="Reactivation bookings" v={fmt.int(totals.reactivation_bookings)} />
            <Stat k="Avg rating" v={totals.avg_rating ? totals.avg_rating.toFixed(1) : "—"} />
          </div>
        </Card>
      </div>
    </>
  );
}
