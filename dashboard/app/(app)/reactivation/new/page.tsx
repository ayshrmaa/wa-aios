"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { previewSegment, createCampaign } from "../../../../lib/actions";
import { PageHead, Card } from "../../../../lib/ui";

const CHF = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "CHF", maximumFractionDigits: 0 }).format(n || 0);

export default function NewCampaignPage() {
  const router = useRouter();
  const [preview, runPreview, previewing] = useActionState(previewSegment, null);

  async function create(formData: FormData) {
    const res = await createCampaign(formData);
    if (res?.ok && res.campaignId) router.push(`/reactivation/${res.campaignId}`);
    else router.push("/reactivation");
  }

  return (
    <>
      <PageHead title="New reactivation campaign" lede="Pick who to reach, what to offer, and how fast to send. Preview the audience before you commit.">
        <Link className="btn" href="/reactivation">← Cancel</Link>
      </PageHead>

      <div className="grid cols-2">
        <Card title="1 · Audience" sub="Preview updates on demand">
          <form action={runPreview} className="stack" style={{ gap: 12 }}>
            <div className="grid cols-2" style={{ gap: 10 }}>
              <div className="field"><label>No booking in (days)</label><input className="input" name="inactiveDays" type="number" defaultValue={90} min={1} /></div>
              <div className="field"><label>Min. past visits</label><input className="input" name="minCompletedBookings" type="number" defaultValue={1} min={0} /></div>
              <div className="field"><label>Service contains (optional)</label><input className="input" name="service" placeholder="e.g. Balayage" /></div>
              <div className="field"><label>Min. lifetime value CHF (optional)</label><input className="input" name="minLifetimeValueChf" type="number" min={0} /></div>
            </div>
            <button className="btn" type="submit" disabled={previewing}>{previewing ? "Checking…" : "Preview audience"}</button>
          </form>

          {preview ? (
            <div style={{ marginTop: 14 }}>
              <div className="row" style={{ gap: 18 }}>
                <div className="stat"><span className="k">Customers</span><span className="v">{preview.total}</span></div>
                <div className="stat"><span className="k">Est. lifetime value</span><span className="v">{CHF(preview.estimatedValueChf)}</span></div>
              </div>
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table className="data">
                  <thead><tr><th>Name</th><th>Last service</th><th>Last visit</th><th className="num">LTV</th><th>Reach</th></tr></thead>
                  <tbody>
                    {preview.sample.map((s, i) => (
                      <tr key={i}>
                        <td>{s.name}</td><td className="muted">{s.lastService || "—"}</td>
                        <td className="muted">{s.lastBookedAt ? new Date(s.lastBookedAt).toLocaleDateString("en-GB") : "—"}</td>
                        <td className="num mono">{CHF(s.lifetimeValueChf)}</td>
                        <td>{s.reachableBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.total > preview.sample.length ? <p className="muted" style={{ fontSize: 12 }}>+ {preview.total - preview.sample.length} more</p> : null}
            </div>
          ) : null}
        </Card>

        <Card title="2 · Campaign">
          <form action={create} className="stack" style={{ gap: 12 }}>
            <div className="field"><label>Campaign name</label><input className="input" name="name" defaultValue="Win-back" required /></div>
            {/* mirror the audience criteria into the create call */}
            <div className="grid cols-2" style={{ gap: 10 }}>
              <div className="field"><label>No booking in (days)</label><input className="input" name="inactiveDays" type="number" defaultValue={preview?.criteria.inactiveDays ?? 90} /></div>
              <div className="field"><label>Min. past visits</label><input className="input" name="minCompletedBookings" type="number" defaultValue={preview?.criteria.minCompletedBookings ?? 1} /></div>
              <div className="field"><label>Service contains</label><input className="input" name="service" defaultValue={preview?.criteria.service ?? ""} /></div>
              <div className="field"><label>Min lifetime value CHF</label><input className="input" name="minLifetimeValueChf" type="number" defaultValue={preview?.criteria.minLifetimeValueChf ?? ""} /></div>
            </div>
            <div className="grid cols-2" style={{ gap: 10 }}>
              <div className="field"><label>Channel</label>
                <select className="select" name="channel" defaultValue="email">
                  <option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="instagram">Instagram</option>
                </select>
              </div>
              <div className="field"><label>Daily send cap</label><input className="input" name="dailySendCap" type="number" defaultValue={40} /></div>
            </div>
            <div className="field"><label>Incentive (optional — the AI weaves it in)</label><input className="input" name="offer" placeholder="e.g. 20% off your next colour this month" /></div>
            <div className="field"><label>Goal / tone note (optional)</label><input className="input" name="goal" placeholder="e.g. friendly, mention the new stylist" /></div>
            <div className="field"><label>Message style</label>
              <select className="select" name="messageStyle" defaultValue="warm"><option value="warm">Warm</option><option value="brief">Brief</option><option value="premium">Premium</option></select>
            </div>
            <button className="btn primary" type="submit">Create campaign (draft)</button>
            <p className="muted" style={{ fontSize: 12 }}>Creating snapshots the audience. You launch it from the campaign page.</p>
          </form>
        </Card>
      </div>
    </>
  );
}
