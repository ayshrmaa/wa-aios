import Link from "next/link";
import { getReactivation, connected } from "../../../lib/api";
import { setCampaignStatus } from "../../../lib/actions";
import { fmt, label } from "../../../lib/format";
import { PageHead, Card, Badge, Stat, Offline, Empty } from "../../../lib/ui";

export const dynamic = "force-dynamic";

export default async function ReactivationPage() {
  if (!connected) return (<><PageHead title="Reactivation" /><Offline what="Reactivation campaigns" /></>);
  const { campaigns } = await getReactivation();
  const active = campaigns.filter((c) => c.status === "active");
  const totalBookings = campaigns.reduce((n, c) => n + c.bookings, 0);
  const totalSent = campaigns.reduce((n, c) => n + c.messages_sent, 0);
  const totalResponses = campaigns.reduce((n, c) => n + c.responses, 0);

  return (
    <>
      <PageHead title="Reactivation" lede="Win back quiet customers. The AI writes each message and handles the reply through to a booking.">
        <Link className="btn primary" href="/reactivation/new">+ New campaign</Link>
      </PageHead>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Stat k="Active campaigns" v={fmt.int(active.length)} />
        <Stat k="Messages sent" v={fmt.int(totalSent)} />
        <Stat k="Replies" v={fmt.int(totalResponses)} foot={totalSent ? fmt.pct((totalResponses / totalSent) * 100) + " reply rate" : undefined} />
        <Stat k="Bookings won" v={fmt.int(totalBookings)} />
      </div>

      {campaigns.length ? (
        <div className="grid cols-2">
          {campaigns.map((c) => {
            const crit = c.criteria as { inactiveDays?: number; minCompletedBookings?: number; service?: string };
            return (
              <Card key={c.id} title={c.name} action={<Badge value={c.status} />}>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
                  No booking in {crit.inactiveDays ?? 90}d · {crit.minCompletedBookings ?? 1}+ past visits{crit.service ? ` · ${crit.service}` : ""} · {label(c.channel)}
                  {c.offer ? <> · offer: “{c.offer}”</> : null}
                </div>
                <div className="grid cols-4" style={{ gap: 8 }}>
                  <div className="stat"><span className="k">Targeted</span><span className="v" style={{ fontSize: 18 }}>{c.total_targeted}</span></div>
                  <div className="stat"><span className="k">Sent</span><span className="v" style={{ fontSize: 18 }}>{c.messages_sent}</span></div>
                  <div className="stat"><span className="k">Replies</span><span className="v" style={{ fontSize: 18 }}>{c.responses}</span></div>
                  <div className="stat"><span className="k">Booked</span><span className="v" style={{ fontSize: 18 }}>{c.bookings}</span></div>
                </div>
                <div className="row" style={{ gap: 6, marginTop: 12 }}>
                  <Link className="btn sm" href={`/reactivation/${c.id}`}>Open</Link>
                  {c.status === "active" ? (
                    <form action={setCampaignStatus}><input type="hidden" name="campaignId" value={c.id} /><input type="hidden" name="status" value="paused" /><button className="btn sm ghost" type="submit">Pause</button></form>
                  ) : null}
                  {c.status === "paused" ? (
                    <form action={setCampaignStatus}><input type="hidden" name="campaignId" value={c.id} /><input type="hidden" name="status" value="active" /><button className="btn sm ghost" type="submit">Resume</button></form>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      ) : <Empty>No campaigns yet. Create one to start winning back lapsed customers.</Empty>}
    </>
  );
}
