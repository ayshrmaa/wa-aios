import { jsonValue } from "./database.mjs";
import { formatSpoken } from "./time.mjs";

const defaultTemplates = {
  "de-CH": {
    appointment_t_48h: {
      subject: "Ihr Termin bei {{salonName}} in zwei Tagen",
      body: "Guten Tag {{firstName}}, wir freuen uns auf Ihren Termin für {{service}} bei {{staff}} am {{appointmentTime}}. Falls etwas dazwischenkommt, melden Sie sich bitte rechtzeitig bei uns.",
      whatsapp: { name: "appointment_t_48h", bodyParameters: ["firstName", "service", "staff", "appointmentTime"] }
    },
    appointment_t_24h: {
      subject: "Erinnerung: Ihr Termin morgen bei {{salonName}}",
      body: "Guten Tag {{firstName}}, dies ist die Erinnerung an Ihren Termin für {{service}} bei {{staff}} morgen, {{appointmentTime}}. Wir freuen uns auf Sie.",
      whatsapp: { name: "appointment_t_24h", bodyParameters: ["firstName", "service", "staff", "appointmentTime"] }
    },
    appointment_t_2h: {
      subject: "Ihr Termin beginnt in zwei Stunden",
      body: "Guten Tag {{firstName}}, Ihr Termin für {{service}} bei {{staff}} beginnt in zwei Stunden, {{appointmentTime}}. Bis bald bei {{salonName}}.",
      whatsapp: { name: "appointment_t_2h", bodyParameters: ["firstName", "service", "staff", "appointmentTime"] }
    },
    no_show_t_30m: {
      subject: "Wir haben Sie heute vermisst",
      body: "Guten Tag {{firstName}}, wir haben Sie heute zu Ihrem Termin für {{service}} vermisst. Wenn Sie möchten, finden wir gern einen neuen Termin für Sie.",
      whatsapp: { name: "no_show_t_30m", bodyParameters: ["firstName", "service"] }
    },
    no_show_day_1: {
      subject: "Möchten Sie einen neuen Termin?",
      body: "Guten Tag {{firstName}}, für Ihren verpassten Termin für {{service}} finden wir gern einen neuen passenden Zeitpunkt. Antworten Sie auf diese Nachricht oder rufen Sie uns an.",
      whatsapp: { name: "no_show_day_1", bodyParameters: ["firstName", "service"] }
    },
    no_show_day_3: {
      subject: "Ihr Termin bei {{salonName}}",
      body: "Guten Tag {{firstName}}, wir möchten Ihnen die Möglichkeit geben, Ihren Termin für {{service}} unkompliziert neu zu buchen. Unser Team hilft Ihnen gern weiter.",
      whatsapp: { name: "no_show_day_3", bodyParameters: ["firstName", "service"] }
    },
    no_show_day_7: {
      subject: "Letzte Erinnerung zur Neubuchung",
      body: "Guten Tag {{firstName}}, falls Sie weiterhin einen Termin für {{service}} wünschen, sind wir gern für Sie da. Diese Nachricht ist unsere letzte Erinnerung.",
      whatsapp: { name: "no_show_day_7", bodyParameters: ["firstName", "service"] }
    },
    review_rating_gate: {
      subject: "Wie war Ihr Termin bei {{salonName}}?",
      body: "Guten Tag {{firstName}}, danke für Ihren Besuch bei {{salonName}}. Wie zufrieden waren Sie mit {{service}}? Bitte geben Sie uns eine Bewertung von 1 bis 5: {{ratingUrl}}",
      whatsapp: { name: "review_rating_gate", bodyParameters: ["firstName", "service", "ratingUrl"] }
    },
    review_request: {
      subject: "Danke für Ihre Rückmeldung",
      body: "Guten Tag {{firstName}}, danke für Ihren Besuch bei {{salonName}}. Ihre Rückmeldung zu {{service}} hilft uns sehr: {{reviewUrl}}",
      whatsapp: { name: "review_request", bodyParameters: ["firstName", "service", "reviewUrl"] }
    },
    complaint_owner_alert: {
      subject: "Neue Kundenbeschwerde: {{severity}}",
      body: "Neue Kundenbeschwerde von {{firstName}}. Einstufung: {{severity}}. Anliegen: {{complaintBody}}. Bitte persönlich prüfen und nachfassen.",
      whatsapp: { name: "complaint_owner_alert", bodyParameters: ["firstName", "severity", "complaintBody"] }
    }
  },
  en: {
    appointment_t_48h: {
      subject: "Your {{salonName}} appointment is in two days",
      body: "Hello {{firstName}}, we look forward to seeing you for {{service}} with {{staff}} on {{appointmentTime}}. Please let us know in good time if your plans change.",
      whatsapp: { name: "appointment_t_48h", bodyParameters: ["firstName", "service", "staff", "appointmentTime"] }
    },
    appointment_t_24h: {
      subject: "Reminder: your {{salonName}} appointment is tomorrow",
      body: "Hello {{firstName}}, this is a reminder for your {{service}} appointment with {{staff}} tomorrow, {{appointmentTime}}. We look forward to seeing you.",
      whatsapp: { name: "appointment_t_24h", bodyParameters: ["firstName", "service", "staff", "appointmentTime"] }
    },
    appointment_t_2h: {
      subject: "Your appointment starts in two hours",
      body: "Hello {{firstName}}, your {{service}} appointment with {{staff}} starts in two hours, {{appointmentTime}}. See you soon at {{salonName}}.",
      whatsapp: { name: "appointment_t_2h", bodyParameters: ["firstName", "service", "staff", "appointmentTime"] }
    },
    no_show_t_30m: {
      subject: "We missed you today",
      body: "Hello {{firstName}}, we missed you at your {{service}} appointment today. If you would like, we can help you find a new time.",
      whatsapp: { name: "no_show_t_30m", bodyParameters: ["firstName", "service"] }
    },
    no_show_day_1: {
      subject: "Would you like to rebook?",
      body: "Hello {{firstName}}, we can help you find a new time for your missed {{service}} appointment. Reply to this message or call us when you are ready.",
      whatsapp: { name: "no_show_day_1", bodyParameters: ["firstName", "service"] }
    },
    no_show_day_3: {
      subject: "Your {{salonName}} appointment",
      body: "Hello {{firstName}}, if you still need {{service}}, we would be happy to help you rebook at a suitable time.",
      whatsapp: { name: "no_show_day_3", bodyParameters: ["firstName", "service"] }
    },
    no_show_day_7: {
      subject: "Final rebooking reminder",
      body: "Hello {{firstName}}, if you would still like {{service}}, our team is here to help. This is our final reminder about the missed appointment.",
      whatsapp: { name: "no_show_day_7", bodyParameters: ["firstName", "service"] }
    },
    review_rating_gate: {
      subject: "How was your visit to {{salonName}}?",
      body: "Hello {{firstName}}, thank you for visiting {{salonName}}. How satisfied were you with {{service}}? Please rate your experience from 1 to 5: {{ratingUrl}}",
      whatsapp: { name: "review_rating_gate", bodyParameters: ["firstName", "service", "ratingUrl"] }
    },
    review_request: {
      subject: "Thank you for your feedback",
      body: "Hello {{firstName}}, thank you for visiting {{salonName}}. Your feedback about {{service}} helps us greatly: {{reviewUrl}}",
      whatsapp: { name: "review_request", bodyParameters: ["firstName", "service", "reviewUrl"] }
    },
    complaint_owner_alert: {
      subject: "New customer complaint: {{severity}}",
      body: "New customer complaint from {{firstName}}. Severity: {{severity}}. Concern: {{complaintBody}}. Please review and follow up personally.",
      whatsapp: { name: "complaint_owner_alert", bodyParameters: ["firstName", "severity", "complaintBody"] }
    }
  }
};

function replaceTokens(value, variables) {
  return String(value ?? "").replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, name) => String(variables[name] ?? ""));
}

function customTemplates(tenant) {
  return jsonValue(tenant?.messaging_config, {}).templates ?? {};
}

function templateForLocale(templates, locale, fallbackLocale, templateId) {
  return templates?.[locale]?.[templateId]
    ?? templates?.[fallbackLocale]?.[templateId]
    ?? templates?.en?.[templateId]
    ?? null;
}

export function renderMessageTemplate({ tenant, templateId, contact = {}, appointment = {}, complaint = {} }) {
  const locale = tenant.locale || "de-CH";
  const fallbackLocale = tenant.fallback_locale || "en";
  const custom = templateForLocale(customTemplates(tenant), locale, fallbackLocale, templateId);
  const fallback = templateForLocale(defaultTemplates, locale, fallbackLocale, templateId);
  if (!fallback && !custom) throw new Error(`No message template exists for ${templateId}.`);
  const template = {
    ...fallback,
    ...custom,
    whatsapp: { ...fallback?.whatsapp, ...custom?.whatsapp }
  };
  const review = tenant.review_config ?? {};
  const scheduledAppointmentTime = appointment.starts_at
    ? formatSpoken(appointment.starts_at, tenant.timezone || "Europe/Zurich")
    : "";
  const variables = {
    salonName: tenant.name || "the salon",
    firstName: contact.first_name || "there",
    service: appointment.service || "your appointment",
    staff: appointment.staff || "our team",
    appointmentTime: scheduledAppointmentTime,
    severity: complaint.severity || "medium",
    complaintBody: complaint.body || "No details supplied.",
    ratingUrl: review.privateFeedbackUrl || review.private_feedback_url || "",
    reviewUrl: review.googleReviewUrl || review.google_review_url || review.privateFeedbackUrl || ""
  };
  return {
    locale: custom ? locale : (fallbackLocale || "en"),
    subject: replaceTokens(template.subject, variables),
    body: replaceTokens(template.body, variables),
    whatsapp: {
      name: template.whatsapp?.name || templateId,
      languageCode: template.whatsapp?.languageCode || locale.replace("-", "_"),
      bodyParameters: (template.whatsapp?.bodyParameters ?? []).map((key) => String(variables[key] ?? ""))
    }
  };
}

