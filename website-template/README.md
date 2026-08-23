# Atelier Nova website template

This Next.js landing page includes a real browser-based Retell demo call. The browser receives only a short-lived web-call access token; the Retell API key stays in the server environment.

## Run locally

Requirements: Node.js 20 or newer and microphone access in a current browser. Microphone access works on `localhost`; a non-local deployment must use HTTPS.

The shared development secret already lives in the parent `../.env` file. Load it into the server process, then run the app:

```bash
npm install
set -a
source ../.env
set +a
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), select **Talk to our receptionist**, and allow microphone access when the browser asks. The default agent is `agent_9fc5538faca03db216cac1fa4b`. To use another agent, set `RETELL_AGENT_ID` in the environment before starting Next.js.

As an alternative to loading `../.env`, copy `.env.example` to `.env.local` and add the values there. `.env.local` is ignored by Git; never commit a real Retell API key.

## Deploy to Vercel

1. Import the repository into Vercel.
2. Set the project **Root Directory** to `website-template`.
3. In **Project Settings → Environment Variables**, add the variables below for each environment that should support demo calls.
4. Deploy. Vercel detects Next.js and runs the production build automatically.

Set these Vercel environment variables:

| Variable | Required | Value |
| --- | --- | --- |
| `RETELL_API_KEY` | Yes | The secret Retell API key. Keep it server-side and never name it with a `NEXT_PUBLIC_` prefix. |
| `RETELL_AGENT_ID` | No | The Retell agent ID. If omitted, the verified default `agent_9fc5538faca03db216cac1fa4b` is used. |

After changing an environment variable in Vercel, redeploy so the new value is available to the route handler.
