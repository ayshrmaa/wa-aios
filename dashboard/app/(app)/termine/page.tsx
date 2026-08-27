import Link from "next/link";
import { getAppointments } from "../../../lib/api";
import { Empty, PageHead, Pill, fmt } from "../../../lib/ui";

export const dynamic = "force-dynamic";

export default async function TerminePage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { scope } = await searchParams;
  const past = scope === "past";
  const rows = await getAppointments(past ? "past" : "upcoming");
  const value = rows.reduce((t, a) => t + (a.status === "booked" || a.status === "completed" ? a.value_chf : 0), 0);
  return (
    <>
      <PageHead title="Termine" lede={past ? "Vergangene Termine mit Status, inklusive erkannter No-shows." : "Bevorstehende Buchungen aus Rezeption, Website und Nachfass-Sequenzen."}>
        <div className="segmented">
          <Link href="/termine" className={!past ? "active" : undefined}>Bevorstehend</Link>
          <Link href="/termine?scope=past" className={past ? "active" : undefined}>Vergangen</Link>
        </div>
      </PageHead>
      <section className="stat-row">
        <article><span>Termine</span><strong>{fmt.int(rows.length)}</strong></article>
        <article><span>{past ? "Umsatz (abgeschlossen)" : "Gebuchter Wert"}</span><strong>{fmt.chf(value)}</strong></article>
        {past ? <article><span>No-shows</span><strong>{fmt.int(rows.filter((a) => a.status === "no_show").length)}</strong></article> : null}
      </section>
      {rows.length ? (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Zeit</th><th>Kundin</th><th>Leistung</th><th>Stylist</th><th>Wert</th><th>Quelle</th><th>Status</th></tr></thead>
          <tbody>{rows.map((a) => (
            <tr key={a.id}>
              <td className="nowrap">{fmt.dateTime(a.starts_at)}</td>
              <td><strong>{fmt.name(a.first_name, a.last_name)}</strong><small>{a.phone_e164 || a.email || ""}</small></td>
              <td>{a.service}</td><td>{a.staff}</td>
              <td className="num">{fmt.chf(a.value_chf)}</td>
              <td><Pill value={a.lead_source} /></td>
              <td><Pill value={a.status} />{a.recovered_from_no_show_id ? <small className="tag">Rückgewonnen</small> : null}{a.status === "no_show" && a.status_source === "inferred" ? <small className="tag">erkannt</small> : null}</td>
            </tr>))}</tbody>
        </table></div>
      ) : <Empty text="Keine Termine in diesem Zeitraum." />}
    </>
  );
}
