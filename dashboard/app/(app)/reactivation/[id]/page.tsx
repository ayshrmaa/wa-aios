import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaign, connected } from "../../../../lib/api";
import { launchCampaign, setCampaignStatus } from "../../../../lib/actions";
import { fmt, label } from "../../../../lib/format";
import { PageHead, Card, Badge, Stat, DataTable, Offline } from "../../../../lib/ui";
import type { CampaignTarget } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!connected) return (<><PageHead title="Campaign" /><Offline what="Campaign detail" /></>);
  const data = await getCampaign(id);
  if (data.error || !data.campaign) notFound();
  const c = data.campaign;
  const crit = c.criteria as { inactiveDays?: number; minCompletedBookings?: number; service?: string };

  return (
    <>
      <PageHead title={c.name} lede={`No booking in ${crit.inactiveDays ?? 90}d · ${crit.minCompletedBookings ?? 1}+ visits · ${label(c.channel)}${c.offer ? ` · “${c.offer}”` : ""}`}>
        <Link className="btn" href="/reactivation">← All campaigns</Link>
        {c.status === "draft" ? (
          <form action={launchCampaign}><input type="hidden" name="campaignId" value={c.id} /><button className="btn primary" type="submit">Launch campaign</button></form>
        ) : null}
        {c.status === "active" ? (
          <form action={setCampaignStatus}><input type="hidden" name="campaignId" value={c.id} /><input type="hidden" name="status" value="paused" /><button className="btn" type="submit">Pause</button></form>
        ) : null}
        {c.status === "paused" ? (
          <form action={setCampaignStatus}><input type="hidden" name="campaignId" value={c.id} /><input type="hidden" name="status" value="active" /><button className="btn" type="submit">Resume</button></form>
        ) : null}
      </PageHead>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Stat k="Status" v={<Badge value={c.status} />} foot={c.launched_at ? `Launched ${fmt.date(c.launched_at)}` : "Not launched"} />
        <Stat k="Targeted" v={fmt.int(c.total_targeted)} />
        <Stat k="Replies" v={fmt.int(c.responses)} foot={c.messages_sent ? fmt.pct((c.responses / c.messages_sent) * 100) : undefined} />
        <Stat k="Bookings" v={fmt.int(c.bookings)} />
      </div>

      <Card title="Recipients">
        <DataTable<CampaignTarget>
          rowKey={(t) => t.id}
          empty="No recipients."
          columns={[
            { key: "who", label: "Customer", render: (t) => <span className="cell-strong">{fmt.name(t.first_name, t.last_name)}</span> },
            { key: "st", label: "Status", render: (t) => <Badge value={t.status} /> },
            { key: "msg", label: "AI message", render: (t) => <span className="muted trunc" title={t.personalised_body || ""}>{t.personalised_body || "—"}</span> },
            { key: "sched", label: "Send", render: (t) => <span className="muted">{t.sent_at ? `sent ${fmt.rel(t.sent_at)}` : fmt.rel(t.scheduled_for)}</span> },
            { key: "resp", label: "Reply", render: (t) => t.responded_at ? <span className="badge ok">replied</span> : t.booked_appointment_id ? <span className="badge ok">booked</span> : <span className="muted">—</span> }
          ]}
          rows={data.targets}
        />
      </Card>
    </>
  );
}
