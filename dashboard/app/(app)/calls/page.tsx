import { getCalls, connected } from "../../../lib/api";
import { fmt, label } from "../../../lib/format";
import { Card, PageHead, Stat, Badge, DataTable, Offline } from "../../../lib/ui";
import type { Call } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function CallsPage() {
  if (!connected) return (<><PageHead title="Calls" /><Offline what="The call log" /></>);
  const { calls, stats } = await getCalls();

  return (
    <>
      <PageHead title="Calls" lede="Every call the AI receptionist handled — recording, transcript and outcome." />
      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Stat k="Calls · 30 days" v={fmt.int(stats.total)} />
        <Stat k="Answered" v={stats.total ? fmt.pct((stats.answered / stats.total) * 100) : "—"} foot={`${stats.answered} answered`} />
        <Stat k="Booked on call" v={fmt.int(stats.booked)} foot={`${stats.transferred} transferred`} />
        <Stat k="Avg duration" v={fmt.dur(stats.avg_duration)} />
      </div>

      <DataTable<Call>
        rowKey={(c) => c.id}
        empty="No calls recorded yet."
        columns={[
          { key: "when", label: "When", render: (c) => (<><div className="cell-strong">{fmt.dateTime(c.started_at)}</div><div className="cell-sub">{fmt.dur(c.duration_seconds)} · {c.direction || "inbound"}</div></>) },
          { key: "caller", label: "Caller", render: (c) => (<><div>{fmt.name(c.first_name, c.last_name)}</div><div className="cell-sub mono">{c.from_number || c.phone_e164 || "—"}</div></>) },
          { key: "outcome", label: "Outcome", render: (c) => <Badge value={c.outcome || "inquiry"} /> },
          { key: "sentiment", label: "Sentiment", render: (c) => c.user_sentiment ? <Badge value={c.user_sentiment}>{c.user_sentiment}</Badge> : <span className="muted">—</span> },
          { key: "summary", label: "Summary", render: (c) => <span className="muted trunc" title={c.summary || ""}>{c.summary || (c.transcript ? c.transcript.slice(0, 80) : "—")}</span> },
          { key: "rec", label: "Recording", render: (c) => c.recording_url ? <a className="btn sm" href={c.recording_url} target="_blank" rel="noreferrer">▶ Play</a> : <span className="muted">—</span> },
          { key: "flag", label: "", render: (c) => (!c.disclosure_played ? <span className="badge bad" title="Recording disclosure not detected">⚠ disclosure</span> : null) }
        ]}
        rows={calls}
      />

      <Card title="Transcripts" sub="Most recent 8" className="tight" >
        <div className="stack">
          {calls.filter((c) => c.transcript).slice(0, 8).map((c) => (
            <details key={c.id}>
              <summary className="row" style={{ cursor: "pointer" }}>
                <strong>{fmt.name(c.first_name, c.last_name)}</strong>
                <span className="muted">{fmt.dateTime(c.started_at)}</span>
                <Badge value={c.outcome || "inquiry"} />
              </summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, color: "var(--ink-dim)", marginTop: 8, lineHeight: 1.6 }}>{c.transcript}</pre>
            </details>
          ))}
          {!calls.some((c) => c.transcript) ? <span className="muted">No transcripts yet.</span> : null}
        </div>
      </Card>
    </>
  );
}
