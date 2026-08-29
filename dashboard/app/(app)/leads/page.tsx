import Link from "next/link";
import { getLeads } from "../../../lib/api";
import { setLeadStatus } from "../../../lib/actions";
import { fmt, label, CHANNEL_LABEL } from "../../../lib/format";
import { PageHead, Badge, DataTable, Card } from "../../../lib/ui";
import type { Lead } from "../../../lib/api";

export const dynamic = "force-dynamic";

const STATUSES = ["all", "new", "contacted", "qualified", "booked", "lost"];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = sp.status && sp.status !== "all" ? sp.status : undefined;
  const { leads, funnel } = await getLeads(status);
  const f = Object.fromEntries(funnel.map((x) => [x.status, x.count]));

  return (
    <>
      <PageHead title="Leads" lede="Every enquiry from any channel, with its follow-up ladder status." />

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Card><div className="stat"><span className="k">Open</span><span className="v">{fmt.int((f.new || 0) + (f.contacted || 0) + (f.qualified || 0))}</span></div></Card>
        <Card><div className="stat"><span className="k">Qualified</span><span className="v">{fmt.int(f.qualified || 0)}</span></div></Card>
        <Card><div className="stat"><span className="k">Booked</span><span className="v">{fmt.int(f.booked || 0)}</span></div></Card>
        <Card><div className="stat"><span className="k">Lost</span><span className="v">{fmt.int(f.lost || 0)}</span></div></Card>
      </div>

      <div className="seg" style={{ marginBottom: 12 }}>
        {STATUSES.map((s) => (
          <Link key={s} href={s === "all" ? "/leads" : `/leads?status=${s}`} className={(sp.status || "all") === s ? "active" : ""}>
            {s[0].toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </div>

      <DataTable<Lead>
        rowKey={(l) => l.id}
        empty="No leads in this view."
        columns={[
          { key: "who", label: "Lead", render: (l) => (
            <Link href={`/customers/${l.contact_id}`}>
              <div className="cell-strong">{fmt.name(l.first_name, l.last_name)}</div>
              <div className="cell-sub">{l.email || l.phone_e164 || l.manychat_subscriber_id || "—"}</div>
            </Link>
          ) },
          { key: "source", label: "Source", render: (l) => <Badge>{CHANNEL_LABEL[l.source] || l.source}</Badge> },
          { key: "interest", label: "Wants", render: (l) => <span>{l.service_interest || "—"}{l.urgency && l.urgency !== "flexible" ? <span className="muted"> · {label(l.urgency)}</span> : null}</span> },
          { key: "status", label: "Status", render: (l) => <Badge value={l.status} /> },
          { key: "ladder", label: "Follow-ups", render: (l) => (
            <span className="mono">{l.follow_ups_sent} sent{l.next_follow_up_at ? <span className="muted"> · next {fmt.rel(l.next_follow_up_at)}</span> : ""}</span>
          ) },
          { key: "age", label: "Age", render: (l) => <span className="muted">{fmt.rel(l.created_at)}</span> },
          { key: "act", label: "", render: (l) => (
            l.status !== "booked" && l.status !== "lost" ? (
              <form action={setLeadStatus} className="row" style={{ gap: 4 }}>
                <input type="hidden" name="leadId" value={l.id} />
                <select className="select" name="status" defaultValue="" style={{ width: 120, padding: "4px 6px", fontSize: 12 }}>
                  <option value="" disabled>Set…</option>
                  <option value="qualified">Qualified</option>
                  <option value="lost">Lost</option>
                </select>
                <button className="btn sm" type="submit">Go</button>
              </form>
            ) : null
          ) }
        ]}
        rows={leads}
      />
    </>
  );
}
