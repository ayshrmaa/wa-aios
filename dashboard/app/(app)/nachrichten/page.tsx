import { getMessages } from "../../../lib/api";
import { Channel, Empty, PageHead, Pill, fmt } from "../../../lib/ui";

export const dynamic = "force-dynamic";
const kinds: Record<string, string> = { appointment_t_48h: "Erinnerung 48h", appointment_t_24h: "Erinnerung 24h", appointment_t_2h: "Erinnerung 2h", no_show_t_30m: "No-show 30min", no_show_day_1: "No-show Tag 1", no_show_day_3: "No-show Tag 3", no_show_day_7: "No-show Tag 7", review_rating_gate: "Bewertung", review_request: "Bewertung", complaint_owner_alert: "Alarm Leitung", lead_followup_instant: "Lead sofort", lead_followup_day_1: "Lead Tag 1", lead_followup_day_3: "Lead Tag 3", lead_reengage_day_7: "Lead Tag 7", lead_reengage_day_14: "Lead Tag 14" };

export default async function NachrichtenPage() {
  const messages = await getMessages();
  const queued = messages.filter((m) => m.delivery_status === "queued").length;
  const sent = messages.filter((m) => ["sent", "delivered"].includes(m.delivery_status)).length;
  const stubbed = messages.filter((m) => m.delivery_status === "stubbed").length;
  return (
    <>
      <PageHead title="Nachrichten" lede="Erinnerungen, Nachfass-Sequenzen und Bewertungsanfragen — geplant, gesendet oder bewusst unterdrückt (Ruhezeit 21–08 Uhr)." />
      <section className="stat-row">
        <article><span>Geplant</span><strong>{fmt.int(queued)}</strong></article>
        <article><span>Gesendet</span><strong>{fmt.int(sent)}</strong></article>
        {stubbed ? <article className="alert"><span>Simuliert</span><strong>{fmt.int(stubbed)}</strong><small>kein Versanddienst verbunden</small></article> : null}
      </section>
      {messages.length ? (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Zeitpunkt</th><th>Empfänger</th><th>Art</th><th>Kanal</th><th>Status</th><th>Text</th></tr></thead>
          <tbody>{messages.map((m) => (
            <tr key={m.id}>
              <td className="nowrap">{fmt.dateTime(m.sent_at || m.scheduled_for || m.created_at)}</td>
              <td><strong>{m.first_name || "—"}</strong><small>{m.email || m.phone_e164 || ""}</small></td>
              <td>{kinds[m.template_id ?? ""] ?? m.template_id ?? "—"}</td>
              <td><Channel value={m.channel} /></td>
              <td><Pill value={m.delivery_status} /></td>
              <td className="body">{m.body}</td>
            </tr>))}</tbody>
        </table></div>
      ) : <Empty text="Noch keine Nachrichten." />}
    </>
  );
}
