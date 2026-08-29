import Link from "next/link";
import { getCustomers, connected } from "../../../lib/api";
import { fmt } from "../../../lib/format";
import { PageHead, Stat, Badge, DataTable, Offline, Avatar } from "../../../lib/ui";
import type { Customer } from "../../../lib/api";

export const dynamic = "force-dynamic";

const STAGES = ["all", "lead", "active", "inactive", "vip"];

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ stage?: string; q?: string }> }) {
  if (!connected) return (<><PageHead title="Customers" /><Offline what="The customer database" /></>);
  const sp = await searchParams;
  const stage = sp.stage && sp.stage !== "all" ? sp.stage : undefined;
  const { customers, segments } = await getCustomers({ stage, q: sp.q });
  const seg = Object.fromEntries(segments.map((s) => [s.lifecycle_stage, s.count]));
  const total = segments.reduce((n, s) => n + s.count, 0);

  return (
    <>
      <PageHead title="Customers" lede="Every contact the receptionist has spoken to — leads and returning clients in one place." />

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Stat k="Total contacts" v={fmt.int(total)} />
        <Stat k="Active" v={fmt.int(seg.active || 0)} />
        <Stat k="Lapsed" v={fmt.int(seg.inactive || 0)} foot="Target with reactivation" />
        <Stat k="VIP" v={fmt.int(seg.vip || 0)} />
      </div>

      <div className="row spread" style={{ marginBottom: 12 }}>
        <div className="seg">
          {STAGES.map((s) => (
            <Link key={s} href={s === "all" ? "/customers" : `/customers?stage=${s}`} className={(sp.stage || "all") === s ? "active" : ""}>
              {s[0].toUpperCase() + s.slice(1)}
            </Link>
          ))}
        </div>
        <form className="row" style={{ gap: 6 }}>
          {sp.stage ? <input type="hidden" name="stage" value={sp.stage} /> : null}
          <input className="input" name="q" placeholder="Search name, email, phone…" defaultValue={sp.q || ""} style={{ width: 240 }} />
          <button className="btn sm" type="submit">Search</button>
        </form>
      </div>

      <DataTable<Customer>
        rowKey={(c) => c.id}
        empty="No customers match."
        columns={[
          { key: "name", label: "Customer", render: (c) => (
            <Link href={`/customers/${c.id}`} className="row" style={{ gap: 10 }}>
              <Avatar first={c.first_name} last={c.last_name} />
              <span>
                <div className="cell-strong">{fmt.name(c.first_name, c.last_name)}</div>
                <div className="cell-sub">{c.email || c.phone_e164 || "—"}</div>
              </span>
            </Link>
          ) },
          { key: "stage", label: "Stage", render: (c) => <Badge value={c.lifecycle_stage} /> },
          { key: "bookings", label: "Visits", num: true, render: (c) => <span className="mono">{c.completed_bookings}{c.no_show_count ? <span className="muted"> · {c.no_show_count} NS</span> : null}</span> },
          { key: "ltv", label: "Lifetime", num: true, render: (c) => <span className="mono">{fmt.chf(c.lifetime_value_chf)}</span> },
          { key: "last", label: "Last seen", render: (c) => <span title={fmt.dateTime(c.last_interaction_at)}>{fmt.rel(c.last_interaction_at)}</span> },
          { key: "next", label: "Upcoming", render: (c) => c.upcoming ? <span className="badge info">{c.upcoming} booked</span> : <span className="muted">—</span> }
        ]}
        rows={customers}
      />
    </>
  );
}
