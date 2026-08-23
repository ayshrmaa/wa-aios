import type { KpiDay, SourceKey } from "./types";

const sources: SourceKey[] = ["call", "instagram", "whatsapp", "website", "google"];

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function sum(rows: KpiDay[], key: keyof KpiDay) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

export function calculateMetrics(rows: KpiDay[]) {
  const latestDate = rows.length ? new Date(`${rows.at(-1)!.kpi_date}T12:00:00Z`) : new Date();
  const currentStart = new Date(Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth() + 1, 1));
  const previousStart = new Date(Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth() - 1, 1));
  const current = rows.filter((row) => row.kpi_date >= dateOnly(currentStart) && row.kpi_date < dateOnly(nextMonth));
  const previousMonthDays = new Date(Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth(), 0)).getUTCDate();
  const comparisonDays = Math.min(latestDate.getUTCDate(), previousMonthDays);
  const currentComparisonEnd = new Date(currentStart);
  currentComparisonEnd.setUTCDate(comparisonDays + 1);
  const previousComparisonEnd = new Date(previousStart);
  previousComparisonEnd.setUTCDate(comparisonDays + 1);
  const currentComparison = rows.filter((row) => row.kpi_date >= dateOnly(currentStart) && row.kpi_date < dateOnly(currentComparisonEnd));
  const previousComparison = rows.filter((row) => row.kpi_date >= dateOnly(previousStart) && row.kpi_date < dateOnly(previousComparisonEnd));

  const bookingsCurrent = sum(currentComparison, "bookings_count");
  const bookingsPrevious = sum(previousComparison, "bookings_count");
  const bookingsChange = bookingsPrevious ? ((bookingsCurrent - bookingsPrevious) / bookingsPrevious) * 100 : null;
  const callsAnswered = sum(current, "calls_answered");
  const callsMissed = sum(current, "calls_missed");
  const callsTotal = callsAnswered + callsMissed;
  const appointmentsDue = sum(current, "appointments_due");
  const noShows = sum(current, "no_shows");
  const noShowRecoveries = sum(current, "no_show_recoveries");
  const noShowRate = appointmentsDue ? (noShows / appointmentsDue) * 100 : 0;
  const recoveryRate = noShows ? (noShowRecoveries / noShows) * 100 : 0;

  const bySource = Object.fromEntries(sources.map((source) => {
    const leads = sum(current, `leads_${source}` as keyof KpiDay);
    const bookings = sum(current, `bookings_${source}` as keyof KpiDay);
    return [source, { leads, bookings, conversion: leads ? (bookings / leads) * 100 : 0 }];
  })) as Record<SourceKey, { leads: number; bookings: number; conversion: number }>;

  const ratingTrend = rows.slice(-56).reduce<{ label: string; sum: number; count: number }[]>((weeks, row) => {
    const date = new Date(`${row.kpi_date}T12:00:00Z`);
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const label = monday.toISOString().slice(5, 10);
    const currentWeek = weeks.at(-1);
    if (!currentWeek || currentWeek.label !== label) weeks.push({ label, sum: row.rating_sum, count: row.rating_count });
    else { currentWeek.sum += row.rating_sum; currentWeek.count += row.rating_count; }
    return weeks;
  }, []).map((week) => ({ label: week.label, value: week.count ? week.sum / week.count : null }));

  return {
    periodLabel: new Intl.DateTimeFormat("de-CH", { month: "long", year: "numeric", timeZone: "UTC" }).format(latestDate),
    bookingsComparisonLabel: `Erste ${comparisonDays} Tage vs. erste ${comparisonDays} Tage Vormonat`,
    bookingsCurrent, bookingsPrevious, bookingsChange,
    callsAnswered, callsMissed, callsTotal,
    answeredRate: callsTotal ? (callsAnswered / callsTotal) * 100 : 0,
    appointmentsDue, noShows, noShowRate, noShowRecoveries, recoveryRate,
    bySource,
    recoveredAppointments: sum(current, "recovered_appointments"),
    recoveredRevenue: sum(current, "recovered_revenue_estimate_chf"),
    reviewsRequested: sum(current, "reviews_requested"),
    reviewsReceived: sum(current, "reviews_received"),
    ratingTrend
  };
}
