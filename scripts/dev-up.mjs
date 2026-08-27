#!/usr/bin/env node
// Local end-to-end: boots the API, opens a public tunnel, re-points the Retell agent at it.
// Quick tunnels get a NEW url every start, which silently breaks the agent — this script exists so that never happens by hand.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../retell/provision.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = await loadEnv();
const port = env.PORT || "3010";
const children = [];
const stop = () => { for (const c of children) c.kill("SIGTERM"); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);

const api = spawn("node", ["server.mjs"], { cwd: path.join(root, "api"), env: { ...env, PORT: port }, stdio: ["ignore", "inherit", "inherit"] });
children.push(api);
await waitFor(`http://localhost:${port}/health`);
console.log(`\n→ api      http://localhost:${port}`);

const hasTunnel = spawnSync("which", ["cloudflared"]).status === 0;
if (!hasTunnel) {
  console.log("→ tunnel   cloudflared not installed (brew install cloudflared) — API is local only; Retell cannot reach it.");
} else {
  const tunnel = spawn("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(tunnel);
  const url = await new Promise((resolve) => {
    const onData = (chunk) => { const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (m) resolve(m[0]); };
    tunnel.stdout.on("data", onData); tunnel.stderr.on("data", onData);
  });
  console.log(`→ tunnel   ${url}`);
  const sync = spawnSync("node", [path.join(root, "retell/provision.mjs"), "--sync-tools"], { env: { ...env, API_BASE_URL: url }, encoding: "utf8" });
  console.log(sync.status === 0 ? `→ retell   ${sync.stdout.trim()}` : `→ retell   SYNC FAILED: ${sync.stderr.trim() || sync.stdout.trim()}`);
}
console.log("\nCtrl-C stops everything.\n");

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} did not come up`);
}
