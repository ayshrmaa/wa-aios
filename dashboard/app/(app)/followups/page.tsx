import Link from "next/link";
import { getFollowups, connected } from "../../../lib/api";
import { fmt, label } from "../../../lib/format";
import { PageHead, Card, Badge, DataTable, Stat, Offline, Empty } from "../../../lib/ui";
import type { SequenceRun, QueuedMessage } from "../../../lib/api";

export const dynamic = "force-dynamic";

const LADDER_STEPS: Record<string, string> = {
  lead_followup_instant: "Immediate", lead_followup_10min: "10 minutes", lead_followup_2h: "2 hours",
  lead_followup_day_1: "Next day", lead_followup_day_3: "3 days",
  appointment_t_48h: "T-48h", appointment_t_24h: "T-24h", appointment_t_2h: "T-2h"
};

export default async function FollowupsPage() {
  if (!connected) return (<><PageHead title="Follow-ups" /><Offline what="Automation status" /></>);
  const { active, upcoming, summary, outbound30 } = await getFollowups();
  const sum = Object.fromEntries(summary.map((s) => [s.sequence_type, s]));
  const sent30 = outbound30.find((o) => o.delivery_status === "sent")?.count || 0;
  const stub30 = outbound30.find((o) => o.delivery_status === "stubbed")?.count || 0;
  const failed30 = outbound30.find((o) => o.delivery_status === "failed")?.count || 0;

  return (
    <>
      <PageHead title="Follow-ups" lede="Automated message sequences. Every one stops the moment the customer replies or books." />

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Stat k="Active sequences" v={fmt.int(active.length)} />
        <Stat k="Queued sends" v={fmt.int(upcoming.length)} />
        <Stat k="Delivered · 30d" v={fmt.int(sent30 + stub30)} foot={stub30 ? `${stub30} stubbed (no provider)` : undefined} />
        <Stat k="Stopped early · 30d" v={fmt.int(failed30)} foot="Replied / booked / cancelled" />
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        {["lead_follow_up", "appointment_reminder", "no_show_recovery", "review_request", "reactivation", "appointment_confirmation", "appointment_completion", "re_engagement"]
          .filter((t) => sum[t])
          .map((t) => (
            <Card key={t} className="tight">
              <div className="stat">
                <span className="k">{label(t)}</span>
                <span className="v">{sum[t].active}</span>
                <span className="foot">{sum[t].completed} completed · {sum[t].exited} stopped</span>
              </div>
            </Card>
          ))}
      </div>

      <div className="grid cols-2">
        <Card title="Active sequences" sub="Next message due">
          <DataTable<SequenceRun>
            rowKey={(s) => s.id}
            empty="No active sequences."
            columns={[
              { key: "who", label: "Customer", render: (s) => <Link href={`/customers/${s.contact_id}`}><span className="cell-strong">{fmt.name(s.first_name, s.last_name)}</span></Link> },
              { key: "seq", label: "Sequence", render: (s) => <span>{label(s.sequence_type)}<div className="cell-sub">{LADDER_STEPS[s.current_step] || label(s.current_step)}</div></span> },
              { key: "due", label: "Next", num: true, render: (s) => <span className="mono">{fmt.rel(s.next_fire_at)}</span> }
            ]}
            rows={active.slice(0, 40)}
          />
        </Card>

        <Card title="Queued messages" sub="What goes out next">
          <DataTable<QueuedMessage>
            rowKey={(m) => m.id}
            empty="Nothing queued."
            columns={[
              { key: "who", label: "To", render: (m) => <Link href={`/customers/${m.contact_id}`}>{fmt.name(m.first_name, m.last_name)}</Link> },
              { key: "tpl", label: "Message", render: (m) => <span>{label(m.template_id || "")}<div className="cell-sub trunc">{m.body}</div></span> },
              { key: "ch", label: "Ch.", render: (m) => <Badge>{m.channel}</Badge> },
              { key: "at", label: "Sends", num: true, render: (m) => <span className="mono">{fmt.rel(m.scheduled_for)}</span> }
            ]}
            rows={upcoming.slice(0, 40)}
          />
        </Card>
      </div>
    </>
  );
}
