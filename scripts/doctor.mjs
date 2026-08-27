#!/usr/bin/env node
// Checks every moving part and prints PASS / WARN / FAIL per line. Exit 1 on any FAIL.
//   npm run doctor            fast checks (API, auth, Retell, calendar, transport)
//   npm run doctor -- --build also runs `next build` for dashboard and website
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../retell/provision.mjs";
import { GoogleAuth } from "../api/src/calendar.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = process.argv.includes("--build");
const env = await loadEnv();
const apiBase = (env.API_BASE_URL || "http://localhost:3010").replace(/\/$/, "");
let failed = 0;
const line = (status, label, detail = "") => {
  if (status === "FAIL") failed += 1;
  console.log(`${status.padEnd(4)} ${label}${detail ? ` — ${detail}` : ""}`);
};
const fetchJson = async (url, init = {}, ms = 15000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  } catch (error) {
    return { status: 0, error: error.message };
  } finally { clearTimeout(timer); }
};

// 1. runtime
const major = Number(process.versions.node.split(".")[0]);
line(major >= 20 ? "PASS" : "FAIL", `node ${process.versions.node}`, major >= 20 ? "" : "need 20+");
for (const dir of ["api", "db", "dashboard", "website-template"]) {
  line(existsSync(path.join(root, dir, "node_modules")) ? "PASS" : "FAIL", `${dir}/node_modules`, existsSync(path.join(root, dir, "node_modules")) ? "" : "run npm run install:all");
}

// 2. api
const health = await fetchJson(`${apiBase}/health`);
if (health.status === 200 && health.json) {
  line("PASS", `api ${apiBase}/health`, `db=${health.json.database} calendar=${health.json.calendarProvider}`);
} else {
  line("FAIL", `api ${apiBase}/health`, health.error || `HTTP ${health.status}`);
}
const probe = { startTime: "2030-01-08T10:00:00+01:00", serviceId: "probe", staffId: "probe" };
const noSecret = await fetchJson(`${apiBase}/webhook/check-availability`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(probe) });
if (env.RETELL_WEBHOOK_SECRET) {
  line(noSecret.status === 401 ? "PASS" : "FAIL", "webhook rejects missing secret", `HTTP ${noSecret.status}`);
  const withSecret = await fetchJson(`${apiBase}/webhook/check-availability`, { method: "POST", headers: { "content-type": "application/json", "x-retell-webhook-secret": env.RETELL_WEBHOOK_SECRET }, body: JSON.stringify(probe) });
  line(withSecret.status === 200 ? "PASS" : "FAIL", "webhook accepts correct secret", `HTTP ${withSecret.status}`);
} else {
  line("WARN", "RETELL_WEBHOOK_SECRET unset", `webhooks are open to the internet (HTTP ${noSecret.status} without auth)`);
}

// 3. retell
if (!env.RETELL_API_KEY) {
  line("FAIL", "RETELL_API_KEY", "unset — the voice agent cannot be provisioned");
} else {
  const agents = await fetchJson("https://api.retellai.com/list-agents", { headers: { authorization: `Bearer ${env.RETELL_API_KEY}` } });
  line(agents.status === 200 ? "PASS" : "FAIL", "Retell API key", agents.status === 200 ? `${agents.json.length} agent(s) on account` : `HTTP ${agents.status}`);
  let ids = null;
  for (const file of ["retell/.retell-ids.json", ".retell-ids.json"]) {
    if (existsSync(path.join(root, file))) { ids = JSON.parse(await readFile(path.join(root, file), "utf8")); break; }
  }
  if (env.RETELL_LLM_ID && env.RETELL_AGENT_ID) ids = { llm_id: env.RETELL_LLM_ID, agent_id: env.RETELL_AGENT_ID };
  if (!ids) {
    line("FAIL", "Retell agent", "no ids — run npm run retell:provision");
  } else if (agents.status === 200) {
    const llm = await fetchJson(`https://api.retellai.com/get-retell-llm/${ids.llm_id}`, { headers: { authorization: `Bearer ${env.RETELL_API_KEY}` } });
    if (llm.status !== 200) line("FAIL", `Retell llm ${ids.llm_id}`, `HTTP ${llm.status}`);
    else {
      const custom = llm.json.general_tools.filter((t) => t.url);
      const disclosure = /recorded|aufgezeichnet|enregistr/i.test(llm.json.begin_message || "");
      line(disclosure ? "PASS" : "FAIL", "recording disclosure in begin_message", disclosure ? "" : "Swiss law requires it on every call");
      let reachable = 0, wrongHost = 0;
      for (const tool of custom) {
        const sameHost = tool.url.startsWith(apiBase);
        if (!sameHost) wrongHost += 1;
        const r = await fetchJson(tool.url, { method: "POST", headers: { "content-type": "application/json", ...(tool.headers ?? {}) }, body: JSON.stringify(probe) });
        if (r.status && r.status !== 404 && r.status !== 401) reachable += 1;
      }
      line(reachable === custom.length ? "PASS" : "FAIL", `agent tools reachable ${reachable}/${custom.length}`, reachable === custom.length ? "" : "tool URLs point at a dead or unauthenticated host — run npm run retell:sync");
      if (wrongHost) line("WARN", `${wrongHost} tool URL(s) do not match API_BASE_URL`, `agent → ${custom[0]?.url.replace(/\/webhook.*/, "")}, doctor → ${apiBase}`);
    }
  }
}

// 3b. dashboard API
if (!env.DASHBOARD_API_TOKEN) line("WARN", "DASHBOARD_API_TOKEN unset", "the owner dashboard cannot read live data (/api/dashboard/* returns 503)");
else {
  const d = await fetchJson(`${apiBase}/api/dashboard/overview`, { headers: { authorization: `Bearer ${env.DASHBOARD_API_TOKEN}` } });
  line(d.status === 200 ? "PASS" : "FAIL", "dashboard API", d.status === 200 ? `live: ${d.json.live.upcoming_appointments} upcoming, ${d.json.live.open_leads} open leads` : `HTTP ${d.status}`);
}
if (!env.DASHBOARD_PASSWORD) line("WARN", "DASHBOARD_PASSWORD unset", "dashboard is open to anyone with the URL — fine for a demo, not for a salon");
if (env.MANYCHAT_API_KEY) line("PASS", "ManyChat", "API key set — Instagram/WhatsApp DM follow-ups can send");
else line("WARN", "ManyChat", "MANYCHAT_API_KEY unset — Instagram leads are captured but DM follow-ups stay stubbed");

// 4. calendar
const provider = env.CALENDAR_PROVIDER || "local";
if (provider === "local") line("WARN", "CALENDAR_PROVIDER=local", "bookings go to the embedded calendar, not Google. Fine for demo, not production.");
else if (provider === "google") {
  const mode = GoogleAuth.describe(env);
  if (!mode) line("FAIL", "CALENDAR_PROVIDER=google", "no Google credentials — see api/CONFIGURATION.md");
  else if (mode === "static_token") line("WARN", "Google calendar auth", "static access token — expires hourly, dev only");
  else {
    try {
      const auth = new GoogleAuth({ env, logger: { warn() {} } });
      await auth.token();
      line("PASS", `Google calendar auth (${mode})`, "token minted");
    } catch (error) { line("FAIL", `Google calendar auth (${mode})`, error.message.slice(0, 160)); }
  }
} else line("FAIL", `CALENDAR_PROVIDER=${provider}`, "unknown provider");

// 5. transport
if (env.RESEND_API_KEY) line("PASS", "email transport", `Resend configured, from ${env.MAIL_FROM || "(MAIL_FROM unset!)"}`);
else line("WARN", "email transport", "RESEND_API_KEY unset — reminders and review requests are logged, not sent");
if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) line("PASS", "whatsapp transport", "Meta Cloud configured");
else line("WARN", "whatsapp transport", "not configured — needs Meta business verification first");
if (!env.DATABASE_URL) line("WARN", "DATABASE_URL unset", "embedded PGlite — data lives in api/data/pglite on this machine only");
else line("PASS", "DATABASE_URL", "external Postgres configured");

// 6. builds
if (build) {
  for (const dir of ["dashboard", "website-template"]) {
    const r = spawnSync("npm", ["run", "build"], { cwd: path.join(root, dir), encoding: "utf8" });
    line(r.status === 0 ? "PASS" : "FAIL", `${dir} next build`, r.status === 0 ? "" : (r.stderr || r.stdout).split("\n").filter(Boolean).slice(-3).join(" | "));
  }
} else line("SKIP", "next builds", "pass --build to run them");

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
