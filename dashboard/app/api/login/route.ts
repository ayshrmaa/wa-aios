import { NextResponse } from "next/server";
import { COOKIE, checkPassword, cookieOptions, issueToken } from "../../../lib/auth";

export async function POST(request: Request) {
  const form = await request.formData();
  const supplied = String(form.get("password") ?? "");
  const url = new URL(request.url);
  if (!checkPassword(supplied)) {
    await new Promise((r) => setTimeout(r, 600)); // blunt brute-force damper
    return NextResponse.redirect(new URL("/login?error=1", url), 303);
  }
  const response = NextResponse.redirect(new URL("/", url), 303);
  response.cookies.set(COOKIE, issueToken(), cookieOptions);
  return response;
}
