import type { CSSProperties } from "react";
import { getOverview } from "../../lib/api";
import { fmt } from "../../lib/ui";
import { calculateMetrics } from "../../lib/metrics";
import type { SourceKey } from "../../lib/types";

const sourceLabels: Record<SourceKey, string> = {
  call: "Anrufe",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  website: "Website",
  google: "Google"
};

function formatInteger(value: number) {
  return new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("de-CH", { maximumFractionDigits: 1 }).format(value) + "%";
}

function formatChf(value: number) {
  return new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF", maximumFractionDigits: 0 }).format(value);
}

function TrendLine({ points }: { points: { label: string; value: number | null }[] }) {
  const valid = points.map((point, index) => ({ ...point, index })).filter((point): point is typeof point & { value: number } => point.value !== null);
  if (!valid.length) return <div className="empty-chart">Noch keine Bewertungen in diesem Zeitraum.</div>;
  const width = 620, height = 150, pad = 12;
  const min = Math.max(1, Math.min(...valid.map((point) => point.value)) - 0.2);
  const max = 5;
  const coords = valid.map((point) => {
    const x = pad + (point.index / Math.max(points.length - 1, 1)) * (width - pad * 2);
    const y = pad + ((max - point.value) / Math.max(max - min, 0.1)) * (height - pad * 2);
    return { ...point, x, y };
  });
  const path = coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return (
    <div className="trend-wrap">
      <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Durchschnittliche Bewertung der letzten acht Wochen">
        <path className="trend-area" d={`${path} L${coords.at(-1)!.x},${height - pad} L${coords[0].x},${height - pad} Z`} />
        <path className="trend-line" d={path} />
        {coords.map((point) => <circle key={`${point.label}-${point.index}`} cx={point.x} cy={point.y} r="4" />)}
      </svg>
      <div className="trend-labels">{points.map((point) => <span key={point.label}>{point.label}</span>)}</div>
    </div>
  );
}

export default async function DashboardPage() {
  const data = await getOverview();
  const metrics = calculateMetrics(data.kpis);
  const brand = data.tenant.branding || {};
  const style = {
    "--brand": brand.primary || "#173f35",
    "--accent": brand.accent || "#d8ff73",
    "--surface": brand.surface || "#f2f5f3",
    "--ink": brand.ink || "#10231e"
  } as CSSProperties;
  const sourceEntries = Object.entries(metrics.bySource) as [SourceKey, { leads: number; bookings: number; conversion: number }][];
  const maxLeads = Math.max(1, ...sourceEntries.map(([, value]) => value.leads));
  const latestRating = [...metrics.ratingTrend].reverse().find((point) => point.value !== null)?.value || 0;

  return (
    <main className="dashboard-shell" style={style}>

      <section className="intro">
        <div>
          <p className="label">Salon Performance</p>
          <h1>Guten Morgen.</h1>
          <p>Das ist die Wirkung Ihrer Rezeption und Nachfass-Automationen in diesem Monat.</p>
        </div>
        <div className="period-control" aria-label="Aktiver Zeitraum">
          <span>Zeitraum</span>
          <strong>Dieser Monat</strong>
        </div>
      </section>

      <section className="live-strip" aria-label="Jetzt">
        <article><span>Termine heute</span><strong>{fmt.int(data.live.today_appointments)}</strong></article>
        <article><span>Bevorstehend</span><strong>{fmt.int(data.live.upcoming_appointments)}</strong></article>
        <article><span>Offene Leads</span><strong>{fmt.int(data.live.open_leads)}</strong></article>
        <article className={data.live.open_complaints ? "alert" : undefined}><span>Offene Beschwerden</span><strong>{fmt.int(data.live.open_complaints)}</strong></article>
        <article><span>Nachrichten geplant</span><strong>{fmt.int(data.live.queued_messages)}</strong></article>
        <article><span>Anrufe, 7 Tage</span><strong>{fmt.int(data.live.calls_7d)}</strong></article>
      </section>
      <section className="hero-metrics" aria-label="Monatliche Kernzahlen">
        <article className="metric-panel bookings-panel">
          <div className="metric-head"><span>Buchungen</span><span>Monat bis heute</span></div>
          <div className="metric-primary">{formatInteger(metrics.bookingsCurrent)}</div>
          <div className="metric-footer">
            <span className={metrics.bookingsChange !== null && metrics.bookingsChange >= 0 ? "positive" : "negative"}>
              {metrics.bookingsChange === null ? "Keine Vergleichsbasis" : `${metrics.bookingsChange >= 0 ? "+" : ""}${formatPercent(metrics.bookingsChange)}`}
            </span>
            <span>Vormonat {formatInteger(metrics.bookingsPrevious)}</span>
          </div>
          <p className="comparison-basis">{metrics.bookingsComparisonLabel}</p>
        </article>

        <article className="metric-panel calls-panel">
          <div className="metric-head"><span>Anrufe</span><span>Ziel 100% beantwortet</span></div>
          <div className="call-ratio">
            <strong>{formatPercent(metrics.answeredRate)}</strong>
            <div className="ring" style={{ "--value": `${metrics.answeredRate * 3.6}deg` } as CSSProperties}><span>{metrics.callsTotal}</span></div>
          </div>
          <div className="split-stats"><span><b>{metrics.callsAnswered}</b> beantwortet</span><span><b>{metrics.callsMissed}</b> verpasst</span></div>
        </article>
      </section>

      <section className="metric-strip" aria-label="No-shows und Umsatzrueckgewinnung">
        <article>
          <span className="label">No-show Rate</span>
          <strong>{formatPercent(metrics.noShowRate)}</strong>
          <p>{metrics.noShows} von {metrics.appointmentsDue} Terminen</p>
        </article>
        <article>
          <span className="label">Recovery Rate</span>
          <strong>{formatPercent(metrics.recoveryRate)}</strong>
          <p>{metrics.noShowRecoveries} von {metrics.noShows} No-shows zurueckgewonnen</p>
        </article>
        <article className="revenue-stat">
          <span className="label">Geschaetzter rueckgewonnener Umsatz</span>
          <strong>{formatChf(metrics.recoveredRevenue)}</strong>
          <p>Schätzwert: {metrics.recoveredAppointments} Termine x {formatChf(data.tenant.avg_appointment_value_chf)}</p>
        </article>
      </section>

      <section className="detail-grid">
        <article className="detail-panel source-panel">
          <div className="section-title">
            <h2>Wo neue Leads entstehen</h2>
            <p>Leads und Buchungen pro Quelle im aktuellen Monat.</p>
          </div>
          <div className="source-list">
            {sourceEntries.map(([source, value]) => (
              <div className="source-row" key={source}>
                <span>{sourceLabels[source]}</span>
                <div className="bar-track"><i style={{ width: `${Math.max(4, (value.leads / maxLeads) * 100)}%` }} /></div>
                <b>{value.leads}</b>
              </div>
            ))}
          </div>
          <div className="source-legend"><span>Leads nach Quelle</span><span>{formatInteger(sourceEntries.reduce((total, [, value]) => total + value.leads, 0))} gesamt</span></div>
        </article>

        <article className="detail-panel conversion-panel">
          <div className="section-title"><h2>Conversion pro Quelle</h2><p>Anteil der Leads mit einer Buchung.</p></div>
          <div className="conversion-list">
            {sourceEntries.map(([source, value]) => (
              <div key={source}>
                <span>{sourceLabels[source]}</span>
                <strong>{formatPercent(value.conversion)}</strong>
                <small>{value.bookings} Buchungen</small>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="reviews-section">
        <article className="reviews-summary">
          <p className="label">Bewertungen</p>
          <h2>{latestRating ? latestRating.toFixed(1) : "-"}<span>/ 5</span></h2>
          <div className="review-counts">
            <span><b>{metrics.reviewsRequested}</b> angefragt</span>
            <span><b>{metrics.reviewsReceived}</b> erhalten</span>
          </div>
        </article>
        <article className="rating-trend">
          <div className="section-title"><h2>Bewertungstrend</h2><p>Gewichteter Wochendurchschnitt der letzten acht Wochen.</p></div>
          <TrendLine points={metrics.ratingTrend} />
        </article>
      </section>

      <footer>
        <span>{data.tenant.name}</span>
        <span>Datenstand {data.kpis.at(-1)?.kpi_date || "-"}</span>
      </footer>
    </main>
  );
}
