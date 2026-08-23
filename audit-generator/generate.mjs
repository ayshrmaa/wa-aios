import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;

const COLORS = {
  ink: "10231e",
  forest: "173f35",
  moss: "3f665b",
  lime: "d8ff73",
  paper: "f2f5f3",
  white: "fbfcfb",
  muted: "65736f",
  line: "d9e1de",
  coral: "e98b73"
};

function assertString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function assertNumber(value, field, { min = 0, max = Number.POSITIVE_INFINITY, integer = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${field} must be a finite number between ${min} and ${max}`);
  }
  if (integer && !Number.isInteger(value)) throw new Error(`${field} must be an integer`);
  return value;
}

function validateInput(raw) {
  const prospect = raw?.prospect || {};
  const discovery = raw?.discovery || {};
  const projection = raw?.projection || {};
  const ratingScaleMax = assertNumber(discovery.ratingScaleMax, "discovery.ratingScaleMax", { min: 0.01 });
  return {
    prospect: {
      businessName: assertString(prospect.businessName, "prospect.businessName"),
      location: assertString(prospect.location, "prospect.location"),
      preparedFor: assertString(prospect.preparedFor, "prospect.preparedFor")
    },
    discovery: {
      noShowsPerWeek: assertNumber(discovery.noShowsPerWeek, "discovery.noShowsPerWeek"),
      avgAppointmentValueChf: assertNumber(discovery.avgAppointmentValueChf, "discovery.avgAppointmentValueChf", { min: 0.01 }),
      rebookingGapRate: assertNumber(discovery.rebookingGapRate, "discovery.rebookingGapRate", { min: 0, max: 1 }),
      missedCallsPerWeek: assertNumber(discovery.missedCallsPerWeek, "discovery.missedCallsPerWeek"),
      currentReviewCount: assertNumber(discovery.currentReviewCount, "discovery.currentReviewCount", { integer: true }),
      rating: assertNumber(discovery.rating, "discovery.rating", { min: 0, max: ratingScaleMax }),
      ratingScaleMax
    },
    projection: {
      weeksPerYear: assertNumber(projection.weeksPerYear, "projection.weeksPerYear", { min: 1, integer: true }),
      monthsPerYear: assertNumber(projection.monthsPerYear, "projection.monthsPerYear", { min: 1, integer: true })
    }
  };
}

function derive(input) {
  const { discovery, projection } = input;
  const weeklyRevenueLeak = discovery.noShowsPerWeek
    * discovery.avgAppointmentValueChf
    * discovery.rebookingGapRate;
  return {
    weeklyRevenueLeak,
    monthlyRevenueLeak: weeklyRevenueLeak * projection.weeksPerYear / projection.monthsPerYear,
    annualRevenueLeak: weeklyRevenueLeak * projection.weeksPerYear,
    missedCallsPerMonth: discovery.missedCallsPerWeek * projection.weeksPerYear / projection.monthsPerYear
  };
}

function rgb(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => (Number.parseInt(value.slice(offset, offset + 2), 16) / 255).toFixed(4)).join(" ");
}

function latin1(value) {
  return String(value).replace(/[^\u0000-\u00ff]/g, "?");
}

function escapePdfText(value) {
  return latin1(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function wrapText(value, size, maxWidth, bold = false) {
  const words = String(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  const factor = bold ? 0.56 : 0.5;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length * size * factor <= maxWidth || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

class PageCanvas {
  constructor(background = COLORS.paper) {
    this.commands = [];
    this.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, background);
  }

  rect(x, top, width, height, color, radius = 0) {
    const y = PAGE_HEIGHT - top - height;
    this.commands.push(`${rgb(color)} rg`);
    if (!radius) {
      this.commands.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
      return;
    }
    const r = Math.min(radius, width / 2, height / 2);
    const k = 0.5522847498;
    const right = x + width;
    const upper = y + height;
    this.commands.push([
      `${(x + r).toFixed(2)} ${y.toFixed(2)} m`,
      `${(right - r).toFixed(2)} ${y.toFixed(2)} l`,
      `${(right - r + r * k).toFixed(2)} ${y.toFixed(2)} ${right.toFixed(2)} ${(y + r - r * k).toFixed(2)} ${right.toFixed(2)} ${(y + r).toFixed(2)} c`,
      `${right.toFixed(2)} ${(upper - r).toFixed(2)} l`,
      `${right.toFixed(2)} ${(upper - r + r * k).toFixed(2)} ${(right - r + r * k).toFixed(2)} ${upper.toFixed(2)} ${(right - r).toFixed(2)} ${upper.toFixed(2)} c`,
      `${(x + r).toFixed(2)} ${upper.toFixed(2)} l`,
      `${(x + r - r * k).toFixed(2)} ${upper.toFixed(2)} ${x.toFixed(2)} ${(upper - r + r * k).toFixed(2)} ${x.toFixed(2)} ${(upper - r).toFixed(2)} c`,
      `${x.toFixed(2)} ${(y + r).toFixed(2)} l`,
      `${x.toFixed(2)} ${(y + r - r * k).toFixed(2)} ${(x + r - r * k).toFixed(2)} ${y.toFixed(2)} ${(x + r).toFixed(2)} ${y.toFixed(2)} c f`
    ].join("\n"));
  }

  line(x1, top1, x2, top2, color = COLORS.line, width = 1) {
    this.commands.push(`${rgb(color)} RG ${width.toFixed(2)} w ${x1.toFixed(2)} ${(PAGE_HEIGHT - top1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_HEIGHT - top2).toFixed(2)} l S`);
  }

  circle(cx, topCenter, radius, color) {
    const cy = PAGE_HEIGHT - topCenter;
    const k = radius * 0.5522847498;
    this.commands.push(`${rgb(color)} rg`);
    this.commands.push([
      `${(cx + radius).toFixed(2)} ${cy.toFixed(2)} m`,
      `${(cx + radius).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx + k).toFixed(2)} ${(cy + radius).toFixed(2)} ${cx.toFixed(2)} ${(cy + radius).toFixed(2)} c`,
      `${(cx - k).toFixed(2)} ${(cy + radius).toFixed(2)} ${(cx - radius).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx - radius).toFixed(2)} ${cy.toFixed(2)} c`,
      `${(cx - radius).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx - k).toFixed(2)} ${(cy - radius).toFixed(2)} ${cx.toFixed(2)} ${(cy - radius).toFixed(2)} c`,
      `${(cx + k).toFixed(2)} ${(cy - radius).toFixed(2)} ${(cx + radius).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx + radius).toFixed(2)} ${cy.toFixed(2)} c f`
    ].join("\n"));
  }

  text(value, x, top, { size = 11, font = "regular", color = COLORS.ink, maxWidth, leading = 1.28 } = {}) {
    const fontName = font === "bold" ? "F2" : font === "italic" ? "F3" : "F1";
    const lines = maxWidth ? wrapText(value, size, maxWidth, font === "bold") : [String(value)];
    lines.forEach((line, index) => {
      const baseline = PAGE_HEIGHT - top - size - (index * size * leading);
      this.commands.push(`BT /${fontName} ${size.toFixed(2)} Tf ${rgb(color)} rg 1 0 0 1 ${x.toFixed(2)} ${baseline.toFixed(2)} Tm (${escapePdfText(line)}) Tj ET`);
    });
    return top + lines.length * size * leading;
  }

  output() {
    return this.commands.join("\n") + "\n";
  }
}

function formatChf(value) {
  return new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency: "CHF",
    maximumFractionDigits: 0
  }).format(Math.round(value));
}

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat("de-CH", { maximumFractionDigits: digits }).format(value);
}

function addHeader(page, title, businessName, dark = false) {
  const textColor = dark ? COLORS.white : COLORS.ink;
  const muted = dark ? "a7b6b1" : COLORS.muted;
  page.text("WORK ARTIFICIAL", MARGIN, 34, { size: 10, font: "bold", color: dark ? COLORS.lime : COLORS.forest });
  page.text(title, PAGE_WIDTH - MARGIN - 230, 34, { size: 9, color: muted, maxWidth: 230 });
  page.line(MARGIN, 58, PAGE_WIDTH - MARGIN, 58, dark ? "34564d" : COLORS.line, 0.8);
  page.text(businessName, MARGIN, 797, { size: 8.5, color: muted });
  page.text("Discovery-basierter Audit", PAGE_WIDTH - MARGIN - 150, 797, { size: 8.5, color: muted });
  return textColor;
}

function metricCard(page, { x, top, width, label, value, detail, accent = false }) {
  page.rect(x, top, width, 116, accent ? COLORS.forest : COLORS.white, 13);
  page.text(label, x + 16, top + 16, { size: 8.5, font: "bold", color: accent ? "b8cbc5" : COLORS.muted, maxWidth: width - 32 });
  page.text(value, x + 16, top + 42, { size: 26, font: "bold", color: accent ? COLORS.lime : COLORS.ink, maxWidth: width - 32 });
  page.text(detail, x + 16, top + 83, { size: 8.5, color: accent ? COLORS.white : COLORS.muted, maxWidth: width - 32 });
}

function coverPage(input) {
  const page = new PageCanvas(COLORS.ink);
  page.circle(495, 140, 120, COLORS.forest);
  page.circle(525, 115, 58, COLORS.lime);
  page.text("WORK ARTIFICIAL", MARGIN, 42, { size: 11, font: "bold", color: COLORS.lime });
  page.text("SALON REVENUE AUDIT", MARGIN, 185, { size: 10, font: "bold", color: "a7b6b1" });
  page.text("Wo Umsatz verloren geht.", MARGIN, 222, { size: 37, font: "bold", color: COLORS.white, maxWidth: 430, leading: 1.08 });
  page.text("Und wie wir ihn systematisch sichern.", MARGIN, 315, { size: 21, color: "c9d5d1", maxWidth: 390, leading: 1.2 });
  page.rect(MARGIN, 505, PAGE_WIDTH - MARGIN * 2, 136, COLORS.forest, 14);
  page.text("Vorbereitet für", MARGIN + 22, 530, { size: 9, font: "bold", color: "b8cbc5" });
  page.text(input.prospect.businessName, MARGIN + 22, 558, { size: 27, font: "bold", color: COLORS.lime, maxWidth: 420 });
  page.text(`${input.prospect.preparedFor}, ${input.prospect.location}`, MARGIN + 22, 603, { size: 11, color: COLORS.white, maxWidth: 420 });
  page.text("Analyse auf Basis der angegebenen Discovery-Daten", MARGIN, 760, { size: 9, color: "8da39c" });
  return page;
}

function executiveSummaryPage(input, derived) {
  const page = new PageCanvas();
  addHeader(page, "Executive Summary", input.prospect.businessName);
  page.text("Messbare Lecks verdienen zuerst Aufmerksamkeit.", MARGIN, 92, { size: 27, font: "bold", maxWidth: 480, leading: 1.1 });
  page.text("Die Priorität folgt direkt aus den Discovery-Werten. Externe Branchenbenchmarks fliessen nicht in die Rechnung ein.", MARGIN, 164, { size: 11, color: COLORS.muted, maxWidth: 455 });
  const cardWidth = (PAGE_WIDTH - MARGIN * 2 - 14) / 2;
  metricCard(page, {
    x: MARGIN, top: 225, width: cardWidth, label: "NO-SHOWS PRO WOCHE",
    value: formatNumber(input.discovery.noShowsPerWeek),
    detail: `${formatChf(derived.weeklyRevenueLeak)} abgeleitetes Wochenrisiko`, accent: true
  });
  metricCard(page, {
    x: MARGIN + cardWidth + 14, top: 225, width: cardWidth, label: "VERPASSTE ANRUFE PRO WOCHE",
    value: formatNumber(input.discovery.missedCallsPerWeek),
    detail: `${formatNumber(derived.missedCallsPerMonth, 1)} im Monatsmittel`
  });
  metricCard(page, {
    x: MARGIN, top: 355, width: cardWidth, label: "AKTUELLE BEWERTUNGEN",
    value: formatNumber(input.discovery.currentReviewCount),
    detail: "Direkt aus dem Discovery-Input"
  });
  metricCard(page, {
    x: MARGIN + cardWidth + 14, top: 355, width: cardWidth, label: "AKTUELLES RATING",
    value: `${formatNumber(input.discovery.rating, 1)} / ${formatNumber(input.discovery.ratingScaleMax, 0)}`,
    detail: "Ausgangslage für das Review-System"
  });
  page.rect(MARGIN, 515, PAGE_WIDTH - MARGIN * 2, 164, "e6ece9", 13);
  page.text("Audit-Fazit", MARGIN + 20, 538, { size: 10, font: "bold", color: COLORS.forest });
  page.text("No-shows haben einen direkt quantifizierbaren Wertverlust. Verpasste Anrufe und die aktuelle Review-Basis zeigen zwei weitere operative Hebel, ohne dass wir deren Umsatzwirkung erfinden.", MARGIN + 20, 574, { size: 16, font: "bold", maxWidth: 440, leading: 1.28 });
  return page;
}

function revenueLeakPage(input, derived) {
  const page = new PageCanvas();
  addHeader(page, "Revenue Leak Breakdown", input.prospect.businessName);
  page.text("Das No-show-Leck, vollständig aus Inputs gerechnet.", MARGIN, 92, { size: 27, font: "bold", maxWidth: 470, leading: 1.1 });
  page.text("Rebooking Gap bezeichnet den Anteil der No-shows, deren Wert im betrachteten Zeitraum nicht durch eine neue Buchung ersetzt wird.", MARGIN, 164, { size: 10.5, color: COLORS.muted, maxWidth: 470 });

  const y = 236;
  const stepWidth = 144;
  const gap = 16;
  const steps = [
    ["No-shows / Woche", formatNumber(input.discovery.noShowsPerWeek)],
    ["Wert / Termin", formatChf(input.discovery.avgAppointmentValueChf)],
    ["Rebooking Gap", `${formatNumber(input.discovery.rebookingGapRate * 100, 0)}%`]
  ];
  steps.forEach(([label, value], index) => {
    const x = MARGIN + index * (stepWidth + gap);
    page.rect(x, y, stepWidth, 102, index === 1 ? "e6ece9" : COLORS.white, 12);
    page.text(label, x + 14, y + 15, { size: 8.5, font: "bold", color: COLORS.muted, maxWidth: stepWidth - 28 });
    page.text(value, x + 14, y + 49, { size: 21, font: "bold", color: COLORS.ink, maxWidth: stepWidth - 28 });
    if (index < 2) page.text("x", x + stepWidth + 5, y + 52, { size: 13, font: "bold", color: COLORS.moss });
  });

  page.rect(MARGIN, 372, PAGE_WIDTH - MARGIN * 2, 152, COLORS.forest, 14);
  page.text("ABGELEITETES UMSATZRISIKO", MARGIN + 22, 396, { size: 9, font: "bold", color: "b8cbc5" });
  page.text(formatChf(derived.weeklyRevenueLeak), MARGIN + 22, 431, { size: 38, font: "bold", color: COLORS.lime });
  page.text("pro Woche", MARGIN + 22, 482, { size: 11, color: COLORS.white });
  page.text(`${formatChf(derived.monthlyRevenueLeak)} Monatsmittel`, 326, 422, { size: 13, font: "bold", color: COLORS.white, maxWidth: 210 });
  page.text(`${formatChf(derived.annualRevenueLeak)} pro Jahr`, 326, 460, { size: 13, font: "bold", color: COLORS.white, maxWidth: 210 });

  page.text("Rechenweg", MARGIN, 568, { size: 10, font: "bold", color: COLORS.forest });
  page.text(`${formatNumber(input.discovery.noShowsPerWeek)} x ${formatChf(input.discovery.avgAppointmentValueChf)} x ${formatNumber(input.discovery.rebookingGapRate, 2)} = ${formatChf(derived.weeklyRevenueLeak)} pro Woche`, MARGIN, 596, { size: 15, font: "bold", maxWidth: 485 });
  page.text(`Monatsmittel = Wochenwert x ${input.projection.weeksPerYear} / ${input.projection.monthsPerYear}. Jahreswert = Wochenwert x ${input.projection.weeksPerYear}.`, MARGIN, 636, { size: 9.5, color: COLORS.muted, maxWidth: 480 });
  page.text("Schätzung auf Basis der Discovery-Eingaben. Keine Umsatzgarantie.", MARGIN, 704, { size: 9, font: "italic", color: COLORS.muted });
  return page;
}

function solutionMappingPage(input, derived) {
  const page = new PageCanvas();
  addHeader(page, "Solution Mapping", input.prospect.businessName);
  page.text("Jedes Signal bekommt einen klaren operativen Gegenpart.", MARGIN, 92, { size: 27, font: "bold", maxWidth: 475, leading: 1.1 });
  const rows = [
    {
      top: 198,
      signal: `${formatNumber(input.discovery.noShowsPerWeek)} No-shows pro Woche`,
      solution: "Reminder- und Recovery-Automation",
      detail: `Priorisiert das abgeleitete Wochenrisiko von ${formatChf(derived.weeklyRevenueLeak)}.`
    },
    {
      top: 342,
      signal: `${formatNumber(input.discovery.missedCallsPerWeek)} verpasste Anrufe pro Woche`,
      solution: "AI Receptionist",
      detail: "Nimmt Anfragen an, beantwortet häufige Fragen und erfasst den Lead für die Nachfassung."
    },
    {
      top: 486,
      signal: `${formatNumber(input.discovery.currentReviewCount)} Reviews bei ${formatNumber(input.discovery.rating, 1)} / ${formatNumber(input.discovery.ratingScaleMax, 0)}`,
      solution: "Review- und Reputation-System",
      detail: "Fordert Feedback nach abgeschlossenen Terminen an und protokolliert erhaltene Antworten."
    }
  ];
  rows.forEach((row) => {
    page.rect(MARGIN, row.top, 180, 116, COLORS.white, 12);
    page.rect(MARGIN + 196, row.top, PAGE_WIDTH - MARGIN * 2 - 196, 116, "e6ece9", 12);
    page.text("SIGNAL", MARGIN + 15, row.top + 15, { size: 8, font: "bold", color: COLORS.muted });
    page.text(row.signal, MARGIN + 15, row.top + 43, { size: 14, font: "bold", maxWidth: 150 });
    page.text(row.solution, MARGIN + 212, row.top + 18, { size: 16, font: "bold", color: COLORS.forest, maxWidth: 250 });
    page.text(row.detail, MARGIN + 212, row.top + 53, { size: 9.5, color: COLORS.muted, maxWidth: 245 });
  });
  return page;
}

function buildScopePage(input) {
  const page = new PageCanvas();
  addHeader(page, "What We'll Build", input.prospect.businessName);
  page.text("Ein zusammenhängendes System für Anfrage, Termin und Nachfassung.", MARGIN, 92, { size: 27, font: "bold", maxWidth: 470, leading: 1.1 });
  page.text("Der genaue Live-Umfang folgt aus Booking-Tier, Kanalzugängen und Compliance-Freigaben.", MARGIN, 164, { size: 10.5, color: COLORS.muted, maxWidth: 460 });

  const items = [
    ["AI Receptionist", "Anrufe annehmen, FAQs beantworten, Leads erfassen und an Menschen übergeben."],
    ["Termin-Automation", "Bestätigungen, Erinnerungen und No-show-Nachfassung mit Quiet-Hour-Regeln."],
    ["Lead Follow-up", "Nicht gebuchte Anfragen qualifizieren, nachfassen und bei Buchung beenden."],
    ["Review-System", "Anfragen versenden, Antworten erfassen und kritisches Feedback eskalieren."],
    ["Reporting", "Bookings, Calls, No-shows, Recovery, Quellen und Reviews konsistent ausweisen."]
  ];
  items.forEach(([title, detail], index) => {
    const top = 226 + index * 94;
    page.circle(64, top + 29, 15, index % 2 ? "dfe8e4" : COLORS.lime);
    page.text(String.fromCharCode(65 + index), 59, top + 20, { size: 10, font: "bold", color: COLORS.forest });
    page.text(title, 94, top + 7, { size: 15, font: "bold", color: COLORS.ink });
    page.text(detail, 94, top + 34, { size: 9.5, color: COLORS.muted, maxWidth: 420 });
    if (index < items.length - 1) page.line(94, top + 77, PAGE_WIDTH - MARGIN, top + 77, COLORS.line, 0.7);
  });
  return page;
}

function investmentPage(input) {
  const page = new PageCanvas(COLORS.ink);
  addHeader(page, "Investment und nächste Schritte", input.prospect.businessName, true);
  page.text("Investition folgt dem bestätigten Live-Umfang.", MARGIN, 104, { size: 29, font: "bold", color: COLORS.white, maxWidth: 470, leading: 1.1 });
  page.text("Der Discovery-Input enthält keinen Preis. Deshalb weist dieser Audit keinen erfundenen Investitionsbetrag aus.", MARGIN, 184, { size: 11, color: "b8cbc5", maxWidth: 455 });

  page.rect(MARGIN, 260, PAGE_WIDTH - MARGIN * 2, 126, COLORS.forest, 14);
  page.text("INVESTITIONSRAHMEN", MARGIN + 22, 284, { size: 9, font: "bold", color: "b8cbc5" });
  page.text("Individuelles Angebot", MARGIN + 22, 322, { size: 25, font: "bold", color: COLORS.lime });
  page.text("Nach Booking-Tier, Integrationsprüfung und Kanal-Freigaben.", MARGIN + 22, 362, { size: 9.5, color: COLORS.white });

  page.text("Nächste Schritte", MARGIN, 444, { size: 11, font: "bold", color: COLORS.lime });
  const nextSteps = [
    "Booking-Plattform und Schreibrechte bestätigen",
    "Compliance- und Kanalvoraussetzungen prüfen",
    "Umfang, Angebot und Go-live-Plan gemeinsam freigeben"
  ];
  nextSteps.forEach((step, index) => {
    const top = 486 + index * 72;
    page.rect(MARGIN, top, 10, 40, index === 1 ? COLORS.coral : COLORS.lime, 5);
    page.text(step, MARGIN + 28, top + 6, { size: 13, font: "bold", color: COLORS.white, maxWidth: 420 });
  });
  page.text("WORK ARTIFICIAL", MARGIN, 742, { size: 11, font: "bold", color: COLORS.lime });
  page.text("AI systems for salon operations", MARGIN, 767, { size: 9, color: "8da39c" });
  return page;
}

function buildPdf(pages, title) {
  const objects = new Map();
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.set(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  objects.set(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>");

  const pageIds = [];
  pages.forEach((page, index) => {
    const pageId = 6 + index * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const content = Buffer.from(page.output(), "latin1");
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.set(contentId, Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "latin1"),
      content,
      Buffer.from("endstream", "latin1")
    ]));
  });
  objects.set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  const infoId = 6 + pages.length * 2;
  objects.set(infoId, `<< /Title (${escapePdfText(title)}) /Author (Work Artificial) /Subject (Discovery-basierter Salon Revenue Audit) /Creator (WA AIOS Audit Generator) >>`);

  const maxId = infoId;
  const chunks = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = new Array(maxId + 1).fill(0);
  let position = chunks[0].length;
  for (let id = 1; id <= maxId; id += 1) {
    const value = objects.get(id);
    if (!value) throw new Error(`Missing PDF object ${id}`);
    offsets[id] = position;
    const body = Buffer.isBuffer(value) ? value : Buffer.from(value, "latin1");
    const object = Buffer.concat([
      Buffer.from(`${id} 0 obj\n`, "latin1"),
      body,
      Buffer.from("\nendobj\n", "latin1")
    ]);
    chunks.push(object);
    position += object.length;
  }
  const xrefOffset = position;
  const xref = ["xref", `0 ${maxId + 1}`, "0000000000 65535 f "];
  for (let id = 1; id <= maxId; id += 1) xref.push(`${String(offsets[id]).padStart(10, "0")} 00000 n `);
  xref.push("trailer", `<< /Size ${maxId + 1} /Root 1 0 R /Info ${infoId} 0 R >>`, "startxref", String(xrefOffset), "%%EOF", "");
  chunks.push(Buffer.from(xref.join("\n"), "latin1"));
  return Buffer.concat(chunks);
}

const inputPath = path.resolve(process.argv[2] || "example-input.json");
const outputPath = path.resolve(process.argv[3] || "output/pdf/audit.pdf");
const input = validateInput(JSON.parse(await readFile(inputPath, "utf8")));
const derived = derive(input);
const pages = [
  coverPage(input),
  executiveSummaryPage(input, derived),
  revenueLeakPage(input, derived),
  solutionMappingPage(input, derived),
  buildScopePage(input),
  investmentPage(input)
];
const pdf = buildPdf(pages, `${input.prospect.businessName} Salon Revenue Audit`);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, pdf);

console.log(JSON.stringify({
  output: outputPath,
  bytes: pdf.length,
  pages: pages.length,
  calculationTrace: {
    weeklyRevenueLeak: "noShowsPerWeek * avgAppointmentValueChf * rebookingGapRate",
    monthlyRevenueLeak: "weeklyRevenueLeak * weeksPerYear / monthsPerYear",
    annualRevenueLeak: "weeklyRevenueLeak * weeksPerYear",
    missedCallsPerMonth: "missedCallsPerWeek * weeksPerYear / monthsPerYear"
  },
  derived
}, null, 2));
