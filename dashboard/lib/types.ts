export type SourceKey = "call" | "instagram" | "whatsapp" | "website" | "google";

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  locale: string;
  timezone: string;
  currency: string;
  branding: {
    logoText?: string;
    primary?: string;
    accent?: string;
    surface?: string;
    ink?: string;
  };
  contact_config: { address?: string; email?: string; phone?: string };
  avg_appointment_value_chf: number;
  baseline_no_show_rate: number;
};

export type KpiDay = {
  kpi_date: string;
  bookings_count: number;
  calls_answered: number;
  calls_missed: number;
  appointments_due: number;
  no_shows: number;
  no_show_recoveries: number;
  leads_call: number;
  leads_instagram: number;
  leads_whatsapp: number;
  leads_website: number;
  leads_google: number;
  bookings_call: number;
  bookings_instagram: number;
  bookings_whatsapp: number;
  bookings_website: number;
  bookings_google: number;
  recovered_appointments: number;
  recovered_revenue_estimate_chf: number;
  reviews_requested: number;
  reviews_received: number;
  rating_sum: number;
  rating_count: number;
  average_rating: number | null;
};

export type DashboardData = {
  generatedAt?: string;
  source: "postgres" | "seed-snapshot";
  tenant: Tenant;
  kpis: KpiDay[];
};
