import {
  addDateKey,
  localDateKey,
  weekdayForDateKey,
  zonedDateTime
} from "./src/time.mjs";
import http from "node:http";

const baseUrl = (process.env.API_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const timezone = "Europe/Zurich";
const webhookHeaders = {
  "content-type": "application/json",
  ...(process.env.RETELL_WEBHOOK_SECRET
    ? { "x-retell-webhook-secret": process.env.RETELL_WEBHOOK_SECRET }
    : {})
};

function nextTuesday() {
  const today = localDateKey(new Date(), timezone);
  for (let day = 35; day < 70; day += 1) {
    const candidate = addDateKey(today, day);
    if (weekdayForDateKey(candidate) === "tuesday") return candidate;
  }
  throw new Error("Could not choose a future Tuesday.");
}

async function tool(name, body) {
  const path = name.replaceAll("_", "-");
  console.log(`\nTOOL ${name}`);
  console.log(`REQUEST ${JSON.stringify(body)}`);
  const payload = JSON.stringify(body);
  let status;
  let text;
  if (process.env.API_SOCKET_PATH) {
    ({ status, text } = await new Promise((resolve, reject) => {
      const request = http.request({
        socketPath: process.env.API_SOCKET_PATH,
        path: `/webhook/${path}`,
        method: "POST",
        headers: { ...webhookHeaders, "content-length": Buffer.byteLength(payload) }
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
      });
      request.on("error", reject);
      request.end(payload);
    }));
  } else {
    const response = await fetch(`${baseUrl}/webhook/${path}`, {
      method: "POST",
      headers: webhookHeaders,
      body: payload
    });
    status = response.status;
    text = await response.text();
  }
  console.log(`HTTP ${status}`);
  console.log(`RESPONSE ${text}`);
  if (status < 200 || status >= 300) throw new Error(`${name} returned HTTP ${status}`);
  return JSON.parse(text);
}

const requestedStart = zonedDateTime(nextTuesday(), "10:00", timezone).toISOString();
const phone = "+41795550199";

console.log("CALLER: Hi, I'd like to book a cut and finish with Mara.");
console.log("AGENT: Of course. Can I take your name?");
console.log("CALLER: Sophie.");
console.log("AGENT: Is the number you're calling from best for the reminder?");
console.log(`CALLER: Yes, it's ${phone}.`);
console.log("AGENT: And an email for the confirmation?");
console.log("CALLER: sophie.demo@example.ch.");
console.log("AGENT: When suits you?");
console.log(`CALLER: ${requestedStart}.`);

const availability = await tool("check_availability", {
  startTime: requestedStart,
  serviceId: "cut-and-finish",
  staffId: "mara"
});
if (!availability.available && !availability.alternatives?.length) {
  throw new Error(`No bookable demo slot: ${availability.message}`);
}
const chosenStart = availability.available ? availability.startTime : availability.alternatives[0].startTime;
console.log(`AGENT: ${availability.message}`);
console.log("CALLER: That works. Please book it.");

const booking = await tool("book_appointment", {
  startTime: chosenStart,
  serviceId: "cut-and-finish",
  staffId: "mara",
  customerName: "Sophie",
  customerPhone: phone,
  customerEmail: "sophie.demo@example.ch",
  notes: "Booked through demo-call.mjs"
});
if (booking.status !== "booked") throw new Error(`Booking failed: ${booking.message}`);
console.log(`AGENT: You're booked in — Cut & Finish with ${booking.staff}, ${booking.startTime}.`);

const found = await tool("find_appointment", { customerPhone: phone });
if (!found.found || !found.appointments.some((item) => item.appointmentId === booking.appointmentId)) {
  throw new Error("The newly booked appointment was not returned by find-appointment.");
}
console.log(`AGENT: ${found.message}`);

const callLog = await tool("log_call", {
  customerName: "Sophie",
  customerPhone: phone,
  summary: `Booked ${booking.appointmentId} for ${booking.startTime}.`,
  outcome: "booked",
  disclosurePlayed: true,
  answered: true
});
if (!callLog.logged) throw new Error("Call log was not persisted.");

console.log("AGENT: Anything else I can help with?");
console.log("CALLER: No, thanks.");
console.log("AGENT: Thanks for calling Atelier Nova, see you soon.");
console.log(`\nDEMO COMPLETE appointmentId=${booking.appointmentId} callId=${callLog.callId}`);
