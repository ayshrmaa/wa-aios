import Link from "next/link";
import { connected, getLeads } from "../../../lib/api";
import { Channel, Empty, PageHead, Pill, fmt } from "../../../lib/ui";
import { setLeadStatus } from "./actions";

export const dynamic = "force-dynamic";
const order = ["new", "contacted", "qualified", "booked", "lost"];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const { leads, funnel } = await getLeads(status);
  const counts = Object.fromEntries(funnel.map((f) => [f.status, f.count]));
  const total = funnel.reduce((t, f) => t + f.count, 0);
  const conversion = total ? Math.round(((counts.booked ?? 0) / total) * 100) : 0;
  return (
    <>
      <PageHead title="Leads" lede="Jede Anfrage aus Anruf, Instagram, WhatsApp, Website oder Google — automatisch nachgefasst, bis gebucht wird.">
        {!connected ? <span className="hint">Demo: Statusänderungen sind deaktiviert.</span> : null}
      </PageHead>
      <section className="funnel">
        <Link href="/leads" className={!status ? "active" : undefined}><span>Alle</span><strong>{fmt.int(total)}</strong></Link>
        {order.map((s) => <Link key={s} href={`/leads?status=${s}`} className={status === s ? "active" : undefined}><span><Pill value={s} /></span><strong>{fmt.int(counts[s] ?? 0)}</strong></Link>)}
        <div className="funnel-rate"><span>Lead → Buchung</span><strong>{conversion}%</strong></div>
      </section>
      {leads.length ? (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Eingang</th><th>Kontakt</th><th>Quelle</th><th>Interesse</th><th>Dringlichkeit</th><th>Nachfassen</th><th>Status</th><th></th></tr></thead>
          <tbody>{leads.map((l) => (
            <tr key={l.id}>
              <td className="nowrap">{fmt.dateTime(l.created_at)}</td>
              <td><strong>{fmt.name(l.first_name, l.last_name)}</strong><small>{l.phone_e164 || l.email || (l.manychat_subscriber_id ? "Instagram-DM" : "")}</small></td>
              <td><Pill value={l.source} /> <Channel value={l.channel} /></td>
              <td>{l.service_interest || "—"}<small>{l.preferred_time || ""}</small></td>
              <td><Pill value={l.urgency} /></td>
              <td>{l.follow_ups_sent} gesendet<small>{l.next_follow_up_at ? `nächste ${fmt.dateTime(l.next_follow_up_at)}` : "—"}</small></td>
              <td><Pill value={l.status} /></td>
              <td className="actions">{connected && !["booked", "lost"].includes(l.status) ? (
                <form action={setLeadStatus}>
                  <input type="hidden" name="leadId" value={l.id} />
                  {l.status !== "qualified" ? <button name="status" value="qualified" className="mini">Qualifiziert</button> : null}
                  <button name="status" value="lost" className="mini danger">Verloren</button>
                </form>) : null}</td>
            </tr>))}</tbody>
        </table></div>
      ) : <Empty text="Keine Leads mit diesem Status." />}
    </>
  );
}
