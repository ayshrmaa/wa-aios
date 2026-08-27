import { getCalls } from "../../../lib/api";
import { Empty, PageHead, Pill, fmt } from "../../../lib/ui";

export const dynamic = "force-dynamic";

export default async function AnrufePage() {
  const calls = await getCalls();
  const answered = calls.filter((c) => c.answered).length;
  const booked = calls.filter((c) => c.outcome === "booked").length;
  const noDisclosure = calls.filter((c) => c.answered && !c.disclosure_played).length;
  return (
    <>
      <PageHead title="Anrufe" lede="Jeder Anruf, den die KI-Rezeption entgegengenommen hat — mit Ergebnis, Dauer und Aufzeichnungshinweis." />
      <section className="stat-row">
        <article><span>Beantwortet</span><strong>{calls.length ? Math.round((answered / calls.length) * 100) : 0}%</strong><small>{answered} von {calls.length}</small></article>
        <article><span>Direkt gebucht</span><strong>{fmt.int(booked)}</strong></article>
        <article className={noDisclosure ? "alert" : undefined}><span>Ohne Aufzeichnungshinweis</span><strong>{fmt.int(noDisclosure)}</strong><small>muss 0 sein</small></article>
      </section>
      {calls.length ? (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Zeit</th><th>Anrufer</th><th>Dauer</th><th>Ergebnis</th><th>Hinweis</th><th>Transkript</th></tr></thead>
          <tbody>{calls.map((c) => (
            <tr key={c.id}>
              <td className="nowrap">{fmt.dateTime(c.started_at)}</td>
              <td><strong>{c.first_name || "Unbekannt"}</strong><small>{c.phone_e164 || c.retell_call_id}</small></td>
              <td className="num">{fmt.duration(c.duration_seconds)}</td>
              <td><Pill value={c.answered ? (c.outcome || "answered") : "missed"} /></td>
              <td>{c.answered ? (c.disclosure_played ? <span className="ok">✓</span> : <span className="bad">fehlt</span>) : "—"}</td>
              <td>{c.transcript ? <details><summary>anzeigen</summary><pre className="transcript">{c.transcript}</pre>{c.recording_url ? <a href={c.recording_url} target="_blank" rel="noreferrer">Aufnahme</a> : null}</details> : "—"}</td>
            </tr>))}</tbody>
        </table></div>
      ) : <Empty text="Noch keine Anrufe protokolliert." />}
    </>
  );
}
