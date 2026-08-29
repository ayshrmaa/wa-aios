import { NextResponse } from "next/server";

// Liveness probe for the host (Render healthCheckPath). Also reports whether the
// dashboard is pointed at a backend API.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    apiConfigured: Boolean(process.env.AIOS_API_URL && process.env.DASHBOARD_API_TOKEN),
    apiUrl: process.env.AIOS_API_URL || null,
    tenant: process.env.NEXT_PUBLIC_DEMO_TENANT_ID || null
  });
}
