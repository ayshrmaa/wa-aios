import { getReviews } from "../../../lib/api";
import { Empty, PageHead, Pill, fmt } from "../../../lib/ui";

export const dynamic = "force-dynamic";

export default async function BewertungenPage() {
  const { reviews, complaints } = await getReviews();
  const received = reviews.filter((r) => r.received_at);
  const avg = received.length ? received.reduce((t, r) => t + (r.rating ?? 0), 0) / received.length : 0;
  const open = complaints.filter((c) => !c.resolved_at);
  return (
    <>
      <PageHead title="Bewertungen & Beschwerden" lede="Bewertungsanfragen nach jedem Besuch. Unzufriedene Rückmeldungen erreichen die Salonleitung, nie den Autoresponder." />
      <section className="stat-row">
        <article><span>Angefragt</span><strong>{fmt.int(reviews.length)}</strong></article>
        <article><span>Erhalten</span><strong>{fmt.int(received.length)}</strong><small>{reviews.length ? Math.round((received.length / reviews.length) * 100) : 0}% Rücklauf</small></article>
        <article><span>Ø Bewertung</span><strong>{avg ? avg.toFixed(1) : "—"}</strong></article>
        <article className={open.length ? "alert" : undefined}><span>Offene Beschwerden</span><strong>{fmt.int(open.length)}</strong></article>
      </section>
      <div className="two-col">
        <section>
          <h2>Beschwerden</h2>
          {complaints.length ? complaints.map((c) => (
            <article key={c.id} className={`complaint ${c.resolved_at ? "resolved" : ""}`}>
              <header><strong>{c.first_name || "Unbekannt"}</strong><Pill value={c.severity} /><span className="chip">{c.source_channel}</span><time>{fmt.dateTime(c.created_at)}</time></header>
              <p>{c.body}</p>
              <footer>{c.resolved_at ? `Erledigt ${fmt.date(c.resolved_at)}` : c.notified_at ? "Salonleitung informiert" : "Alarm ausstehend"}</footer>
            </article>)) : <Empty text="Keine Beschwerden. Gut so." />}
        </section>
        <section>
          <h2>Bewertungen</h2>
          {reviews.length ? (
            <div className="table-wrap"><table className="table compact">
              <thead><tr><th>Angefragt</th><th>Kundin</th><th>Leistung</th><th>Bewertung</th><th>Weg</th></tr></thead>
              <tbody>{reviews.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{fmt.date(r.requested_at)}</td>
                  <td>{r.first_name || "—"}</td>
                  <td>{r.service || "—"}<small>{r.staff || ""}</small></td>
                  <td>{r.rating ? <span className="stars" aria-label={`${r.rating} von 5`}>{"★".repeat(r.rating)}<span>{"★".repeat(5 - r.rating)}</span></span> : <small>ausstehend</small>}</td>
                  <td>{r.routed_to ? <Pill value={r.routed_to} /> : "—"}</td>
                </tr>))}</tbody>
            </table></div>) : <Empty text="Noch keine Bewertungsanfragen." />}
        </section>
      </div>
    </>
  );
}
