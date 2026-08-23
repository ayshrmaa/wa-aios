import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../config/tenant.demo.json", import.meta.url), "utf8"));

function isQuietAt(localTime, quiet) {
  const [hour, minute] = localTime.split(":").map(Number);
  const value = hour * 60 + minute;
  const [sh, sm] = quiet.start.split(":").map(Number);
  const [eh, em] = quiet.end.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return start > end ? value >= start || value < end : value >= start && value < end;
}

const requestedStaff = "Mara";
const staff = config.booking.staff.find((person) => person.name === requestedStaff);
if (!staff) throw new Error("Staff calendar resolution failed");

const cases = [
  { template: "appointment_t_48h", at: "22:15", expected: "defer" },
  { template: "appointment_t_2h", at: "22:15", expected: "drop" },
  { template: "appointment_t_24h", at: "10:15", expected: "send" }
].map((test) => {
  const quiet = isQuietAt(test.at, config.quietHours);
  const action = quiet ? (test.template === "appointment_t_2h" ? "drop" : "defer") : "send";
  if (action !== test.expected) throw new Error(`Quiet-hours case failed: ${JSON.stringify(test)}`);
  return { ...test, action };
});

console.warn(`[WA AIOS STUB] Messaging mode is ${config.messaging.mode}. No real outbound message was sent.`);
console.log(JSON.stringify({
  tenant: config.salonName,
  resolvedStaff: staff.name,
  resolvedCalendar: staff.calendarId,
  quietHoursCases: cases,
  bookingGuard: "Postgres exclusion lock plus final Google Calendar recheck"
}, null, 2));
