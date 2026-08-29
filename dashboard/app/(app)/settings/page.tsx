import { getSettings, connected } from "../../../lib/api";
import { updateSettings } from "../../../lib/actions";
import { PageHead, Card, Badge, Offline } from "../../../lib/ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!connected) return (<><PageHead title="Settings" /><Offline what="Settings" /></>);
  const { tenant: t } = await getSettings();
  const contact = (t.contact as Record<string, string>) || {};
  const review = (t.review as Record<string, string>) || {};
  const quiet = (t.quietHours as { start?: string; end?: string }) || {};
  const booking = (t.booking as Record<string, unknown>) || {};
  const services = (t.services as { name: string; durationMinutes?: number; priceChf?: number }[]) || [];
  const messaging = (t.messaging as Record<string, unknown>) || {};

  return (
    <>
      <PageHead title="Settings" lede="Salon profile, hours, calendar and messaging. Changes apply to the AI receptionist immediately." />

      <form action={updateSettings} className="grid cols-2">
        <Card title="Salon profile">
          <div className="stack" style={{ gap: 10 }}>
            <div className="field"><label>Name</label><input className="input" name="name" defaultValue={String(t.name || "")} /></div>
            <div className="field"><label>Average appointment value (CHF)</label><input className="input" type="number" name="avgAppointmentValueChf" defaultValue={Number(t.avgAppointmentValueChf || 0)} /></div>
            <div className="field"><label>Phone</label><input className="input" name="contact_phone" defaultValue={contact.phone || ""} /></div>
            <div className="field"><label>Transfer-to-human number</label><input className="input" name="contact_transferPhone" defaultValue={contact.transferPhone || ""} /></div>
            <div className="field"><label>Email</label><input className="input" name="contact_email" defaultValue={contact.email || ""} /></div>
            <div className="field"><label>Address</label><input className="input" name="contact_address" defaultValue={contact.address || ""} /></div>
          </div>
        </Card>

        <Card title="Automation & messaging">
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 10 }}>
              <div className="field" style={{ flex: 1 }}><label>Quiet hours start</label><input className="input" name="quietStart" defaultValue={quiet.start || "21:00"} /></div>
              <div className="field" style={{ flex: 1 }}><label>Quiet hours end</label><input className="input" name="quietEnd" defaultValue={quiet.end || "08:00"} /></div>
            </div>
            <div className="field"><label>Google review link</label><input className="input" name="review_googleReviewUrl" defaultValue={review.googleReviewUrl || ""} /></div>
            <div className="field"><label>Owner alert email (complaints)</label><input className="input" name="review_ownerAlertEmail" defaultValue={review.ownerAlertEmail || ""} /></div>
            <div className="field"><label>Shared Google Calendar ID</label><input className="input" name="bookingSharedCalendarId" defaultValue={String(booking.sharedCalendarId || "primary")} /></div>
            <div className="row" style={{ gap: 8, fontSize: 12.5 }}>
              <span className="muted">Email transport:</span>
              <Badge>{String(messaging.mode || "stub") === "stub" ? "stubbed" : "live"}</Badge>
              <span className="muted">Set via RESEND_API_KEY on the API.</span>
            </div>
          </div>
        </Card>

        <Card title="Services" sub="Edited in config/tenant.demo.json + redeploy — shown here for reference">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Service</th><th className="num">Duration</th><th className="num">Price</th></tr></thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.name}><td>{s.name}</td><td className="num">{s.durationMinutes ?? 60} min</td><td className="num">{s.priceChf ? `CHF ${s.priceChf}` : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Connections">
          <div className="stack" style={{ gap: 8, fontSize: 13 }}>
            <div className="spread"><span>Retell agent</span>{t.retellAgentId ? <Badge value="active">{String(t.retellAgentId).slice(0, 18)}…</Badge> : <Badge>not provisioned</Badge>}</div>
            <div className="spread"><span>Calendar</span><Badge value="active">Google · {String(booking.sharedCalendarId || "primary")}</Badge></div>
            <div className="spread"><span>Timezone</span><span className="muted">{String(t.timezone || "Europe/Zurich")}</span></div>
            <div className="spread"><span>Locale</span><span className="muted">{String(t.locale || "de-CH")}</span></div>
          </div>
        </Card>

        <div style={{ gridColumn: "1 / -1" }}>
          <button className="btn primary" type="submit">Save settings</button>
        </div>
      </form>
    </>
  );
}
