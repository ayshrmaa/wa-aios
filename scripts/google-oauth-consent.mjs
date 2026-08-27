#!/usr/bin/env node
// One-time helper: turns a Google OAuth client into a refresh token for GOOGLE_OAUTH_REFRESH_TOKEN.
// Needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env, and http://localhost:8765/callback
// added as an authorised redirect URI on that client in Google Cloud Console.
import http from "node:http";
import { loadEnv } from "../retell/provision.mjs";

const env = await loadEnv();
const { GOOGLE_OAUTH_CLIENT_ID: id, GOOGLE_OAUTH_CLIENT_SECRET: secret } = env;
if (!id || !secret) { console.error("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env first."); process.exit(1); }
const redirect = "http://localhost:8765/callback";
const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
Object.entries({ client_id: id, redirect_uri: redirect, response_type: "code", access_type: "offline", prompt: "consent", scope: "https://www.googleapis.com/auth/calendar" })
  .forEach(([k, v]) => url.searchParams.set(k, v));

console.log(`\nOpen this in the browser of the Google account that OWNS the salon calendars:\n\n${url}\n\nWaiting for Google to redirect back to ${redirect} ...`);
http.createServer(async (req, res) => {
  const code = new URL(req.url, redirect).searchParams.get("code");
  if (!code) { res.writeHead(400).end("no code"); return; }
  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code" })
  }).then((r) => r.json());
  if (!token.refresh_token) { res.writeHead(500).end("No refresh token returned — revoke the app at myaccount.google.com/permissions and try again."); console.error(token); process.exit(1); }
  res.writeHead(200, { "content-type": "text/plain" }).end("Done. You can close this tab and return to the terminal.");
  console.log(`\nAdd to .env:\n\nCALENDAR_PROVIDER=google\nGOOGLE_OAUTH_REFRESH_TOKEN=${token.refresh_token}\n`);
  process.exit(0);
}).listen(8765);
