import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const COOKIE = "wa_session";
const password = process.env.DASHBOARD_PASSWORD || "";
const secret = process.env.DASHBOARD_SESSION_SECRET || password;
export const authRequired = Boolean(password);
const MAX_AGE_S = 30 * 24 * 3600;

function hmac(value: string) { return createHmac("sha256", secret).update(value).digest("base64url"); }
function safeEqual(a: string, b: string) {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function checkPassword(supplied: string) { return authRequired && safeEqual(supplied, password); }
export function issueToken() { const ts = String(Date.now()); return `${ts}.${hmac(ts)}`; }
export function verifyToken(token: string | undefined) {
  if (!token) return false;
  const [ts, sig] = token.split(".");
  if (!ts || !sig || !safeEqual(sig, hmac(ts))) return false;
  return Date.now() - Number(ts) < MAX_AGE_S * 1000;
}
export async function isAuthenticated() {
  if (!authRequired) return true;
  const store = await cookies();
  return verifyToken(store.get(COOKIE)?.value);
}
export const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE_S };
