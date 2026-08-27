import { NextResponse } from "next/server";
import { COOKIE } from "../../../lib/auth";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", new URL(request.url)), 303);
  response.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
