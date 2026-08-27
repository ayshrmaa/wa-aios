import test from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { CalendarConfigurationError, GoogleAuth, GoogleCalendar } from "../src/calendar.mjs";

const quiet = { warn() {}, info() {}, error() {} };

function tokenFetch({ expiresIn = 3600 } = {}) {
  const calls = { token: 0, api: 0, apiTokens: [] };
  let apiResponses = [];
  const fetchImpl = async (url, options = {}) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      calls.token += 1;
      return new Response(JSON.stringify({ access_token: `tok-${calls.token}`, expires_in: expiresIn }), { status: 200 });
    }
    calls.api += 1;
    calls.apiTokens.push(options.headers?.authorization);
    const next = apiResponses.shift() ?? { status: 200, body: { ok: true } };
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status });
  };
  return { fetchImpl, calls, queue: (...r) => { apiResponses = r; } };
}

const oauthEnv = {
  GOOGLE_OAUTH_CLIENT_ID: "cid",
  GOOGLE_OAUTH_CLIENT_SECRET: "csecret",
  GOOGLE_OAUTH_REFRESH_TOKEN: "rtoken"
};

test("no Google credentials throws a configuration error naming the options", () => {
  assert.throws(() => new GoogleAuth({ env: {}, logger: quiet }), (error) => {
    assert.ok(error instanceof CalendarConfigurationError);
    assert.match(error.message, /GOOGLE_OAUTH_REFRESH_TOKEN/);
    assert.match(error.message, /GOOGLE_SERVICE_ACCOUNT_JSON/);
    return true;
  });
  assert.throws(
    () => new GoogleAuth({ env: { GOOGLE_OAUTH_REFRESH_TOKEN: "x" }, logger: quiet }),
    /GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET/
  );
});

test("refresh-token mode caches the access token and refreshes before expiry", async () => {
  let clock = 1_000_000;
  const { fetchImpl, calls } = tokenFetch({ expiresIn: 3600 });
  const auth = new GoogleAuth({ env: oauthEnv, fetchImpl, now: () => clock, logger: quiet });

  assert.equal(await auth.token(), "tok-1");
  assert.equal(await auth.token(), "tok-1");
  assert.equal(calls.token, 1, "second call must be served from cache");

  clock += 3600 * 1000 - 30_000; // 30s before expiry: inside the 60s safety margin
  assert.equal(await auth.token(), "tok-2");
  assert.equal(calls.token, 2, "token refreshed before it expired");
});

test("a 401 from the Calendar API forces exactly one refresh and retries once", async () => {
  const { fetchImpl, calls, queue } = tokenFetch();
  const auth = new GoogleAuth({ env: oauthEnv, fetchImpl, logger: quiet });
  const calendar = new GoogleCalendar({ auth, fetchImpl, apiBase: "https://cal.test/v3" });
  queue({ status: 401, body: { error: "expired" } }, { status: 200, body: { id: "evt-1" } });

  const created = await calendar.createEvent({
    calendarId: "lea@salon", startTime: "2026-10-01T09:00:00Z", endTime: "2026-10-01T10:00:00Z", summary: "Cut"
  });
  assert.equal(created.id, "evt-1");
  assert.equal(calls.token, 2, "one initial mint plus one forced refresh");
  assert.equal(calls.api, 2, "the request was retried once");
  assert.deepEqual(calls.apiTokens, ["Bearer tok-1", "Bearer tok-2"]);

  queue({ status: 401, body: {} }, { status: 401, body: {} });
  await assert.rejects(() => calendar.deleteEvent({ calendarId: "lea@salon", eventId: "evt-1" }), /401/);
  assert.equal(calls.api, 4, "a second 401 is not retried again");
});

test("service-account mode signs an RS256 JWT that verifies with the public key", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  let assertion;
  const fetchImpl = async (url, options) => {
    assertion = new URLSearchParams(options.body).get("assertion");
    return new Response(JSON.stringify({ access_token: "sa-token", expires_in: 3600 }), { status: 200 });
  };
  const auth = new GoogleAuth({
    env: {
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "bot@proj.iam.gserviceaccount.com", private_key: pem }),
      GOOGLE_IMPERSONATE_EMAIL: "owner@salon.ch"
    },
    fetchImpl, now: () => 1_700_000_000_000, logger: quiet
  });
  assert.equal(await auth.token(), "sa-token");

  const [header, claims, signature] = assertion.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "RS256", typ: "JWT" });
  const body = JSON.parse(Buffer.from(claims, "base64url"));
  assert.equal(body.iss, "bot@proj.iam.gserviceaccount.com");
  assert.equal(body.sub, "owner@salon.ch");
  assert.equal(body.scope, GoogleAuth.SCOPE);
  assert.equal(body.exp - body.iat, 3600);
  const verifier = createVerify("RSA-SHA256").update(`${header}.${claims}`);
  assert.ok(verifier.verify(publicKey, Buffer.from(signature, "base64url")), "signature verifies");
});

test("static access token mode never calls the token endpoint", async () => {
  const { fetchImpl, calls } = tokenFetch();
  const auth = new GoogleAuth({ env: { GOOGLE_CALENDAR_ACCESS_TOKEN: "static" }, fetchImpl, logger: quiet });
  assert.equal(await auth.token(), "static");
  assert.equal(await auth.token({ force: true }), "static");
  assert.equal(calls.token, 0);
});
