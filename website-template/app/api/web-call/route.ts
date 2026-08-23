import { NextResponse } from "next/server";

const RETELL_WEB_CALL_URL = "https://api.retellai.com/v2/create-web-call";
const DEFAULT_RETELL_AGENT_ID = "agent_9fc5538faca03db216cac1fa4b";

type RetellWebCallResponse = {
  access_token?: unknown;
  call_id?: unknown;
};

export const dynamic = "force-dynamic";

export async function POST() {
  const apiKey = process.env.RETELL_API_KEY?.trim();

  if (!apiKey) {
    return NextResponse.json(
      { error: "The web-call service is not configured." },
      { status: 500 }
    );
  }

  const agentId = process.env.RETELL_AGENT_ID?.trim() || DEFAULT_RETELL_AGENT_ID;

  try {
    const response = await fetch(RETELL_WEB_CALL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ agent_id: agentId }),
      cache: "no-store"
    });

    if (!response.ok) {
      console.error(`Retell web-call request failed with status ${response.status}.`);
      return NextResponse.json(
        { error: "The web call could not be started. Please try again." },
        { status: 502 }
      );
    }

    const data = await response.json() as RetellWebCallResponse;

    if (typeof data.access_token !== "string" || typeof data.call_id !== "string") {
      console.error("Retell web-call response did not include the expected fields.");
      return NextResponse.json(
        { error: "The web call could not be started. Please try again." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      accessToken: data.access_token,
      callId: data.call_id
    });
  } catch {
    console.error("Retell web-call request could not be completed.");
    return NextResponse.json(
      { error: "The web call could not be started. Please try again." },
      { status: 502 }
    );
  }
}
