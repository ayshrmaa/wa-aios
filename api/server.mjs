import { randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDatabase } from "./src/database.mjs";
import { createCalendar } from "./src/calendar.mjs";
import { BookingService, tenantIdFromRequest } from "./src/booking-service.mjs";
import { MessageDispatcher } from "./src/dispatcher.mjs";
import { createTransport } from "./src/transport.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const routes = new Map([
  ["/webhook/check-availability", "checkAvailability"],
  ["/webhook/book-appointment", "bookAppointment"],
  ["/webhook/find-appointment", "findAppointment"],
  ["/webhook/reschedule-appointment", "rescheduleAppointment"],
  ["/webhook/cancel-appointment", "cancelAppointment"],
  ["/webhook/log-call", "logCall"],
  ["/webhook/log-complaint", "logComplaint"],
  ["/webhook/log-review-rating", "recordReviewRating"],
  ["/webhook/log-callback", "logCallback"]
]);

function writeLog(logger, level, event, details = {}) {
  const sink = logger?.[level] ?? logger?.log;
  if (!sink) return;
  sink.call(logger, JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details
  }));
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1_000_000) throw Object.assign(new Error("The request was too large to process safely."), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("I could not understand that request. Please try again."), { statusCode: 400 });
  }
}

function requestIdFrom(request) {
  const supplied = request.headers["x-request-id"];
  return typeof supplied === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : randomUUID();
}

function requestIp(request, trustProxy) {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  }
  return request.socket.remoteAddress ?? "unknown";
}

function secretsMatch(expected, supplied) {
  if (typeof supplied !== "string") return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createRateLimiter({ maximum, windowMs }) {
  const clients = new Map();
  let operations = 0;
  return {
    consume(ip, now = Date.now()) {
      operations += 1;
      if (operations % 1_000 === 0) {
        for (const [key, entry] of clients) {
          if (entry.resetAt <= now) clients.delete(key);
        }
      }
      let entry = clients.get(ip);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        clients.set(ip, entry);
      }
      entry.count += 1;
      return {
        allowed: entry.count <= maximum,
        limit: maximum,
        remaining: Math.max(0, maximum - entry.count),
        resetAt: entry.resetAt
      };
    }
  };
}

export async function createRuntime(options = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const host = options.host ?? env.HOST ?? "0.0.0.0";
  const port = Number(options.port ?? env.PORT ?? 3000);
  const socketPath = options.socketPath ?? env.API_SOCKET_PATH ?? null;
  const dataDir = options.dataDir ?? env.PGLITE_DATA_DIR ?? path.join(here, "data", "pglite");
  const databaseUrl = Object.hasOwn(options, "databaseUrl") ? options.databaseUrl : env.DATABASE_URL;
  const opened = await openDatabase({
    dataDir,
    databaseUrl,
    env,
    logger,
    seed: options.seed ?? true
  });
  const calendar = createCalendar({
    provider: options.calendarProvider ?? env.CALENDAR_PROVIDER ?? "local",
    db: opened.db,
    env
  });
  const service = new BookingService({ db: opened.db, calendar, env, logger });
  const transport = options.transport ?? createTransport({ env, logger, fetchImpl: options.fetchImpl ?? fetch });
  const dispatcher = new MessageDispatcher({
    db: opened.db,
    transport,
    logger,
    env,
    maxAttempts: options.messageMaxAttempts,
    batchSize: options.messageDispatchBatchSize,
    baseRetryMs: options.messageRetryBaseMs,
    maxRetryMs: options.messageRetryMaxMs,
    claimLeaseMs: options.messageClaimLeaseMs
  });
  const webhookSecret = String(env.RETELL_WEBHOOK_SECRET ?? "");
  const trustProxy = String(env.TRUST_PROXY ?? "false").toLowerCase() === "true";
  const rateLimitMaximum = positiveInteger(options.rateLimitMax ?? env.RATE_LIMIT_MAX, 120);
  const rateLimitWindowMs = positiveInteger(options.rateLimitWindowMs ?? env.RATE_LIMIT_WINDOW_MS, 60_000);
  const rateLimiter = createRateLimiter({ maximum: rateLimitMaximum, windowMs: rateLimitWindowMs });
  let sweepRunning = false;
  let messagingCycleRunning = false;

  if (!webhookSecret) {
    writeLog(logger, "warn", "webhook_auth_disabled", {
      message: "RETELL_WEBHOOK_SECRET is unset. Webhook requests are currently accepted without authentication."
    });
  }

  const sweepNoShows = async () => {
    if (sweepRunning) return [];
    sweepRunning = true;
    try {
      return await service.sweepNoShows();
    } catch (error) {
      writeLog(logger, "error", "no_show_sweep_failed", { message: error.message });
      return [];
    } finally {
      sweepRunning = false;
    }
  };

  const runMessagingCycle = async () => {
    if (messagingCycleRunning) return null;
    messagingCycleRunning = true;
    try {
      const reviewRequestsScheduled = await service.sweepReviewRequests({ limit: 100 });
      const delivery = await dispatcher.runOnce();
      writeLog(logger, "info", "messaging_cycle_complete", { reviewRequestsScheduled, ...delivery });
      return { reviewRequestsScheduled, ...delivery };
    } catch (error) {
      writeLog(logger, "error", "messaging_cycle_failed", { message: error.message });
      return null;
    } finally {
      messagingCycleRunning = false;
    }
  };

  await dispatcher.initialize();
  await sweepNoShows();
  await runMessagingCycle();
  const sweepIntervalMs = Number(options.noShowSweepIntervalMs ?? env.NO_SHOW_SWEEP_INTERVAL_MS ?? 30_000);
  const sweepTimer = setInterval(sweepNoShows, sweepIntervalMs);
  sweepTimer.unref();
  const messagingIntervalMs = Number(options.messageDispatchIntervalMs ?? env.MESSAGE_DISPATCH_INTERVAL_MS ?? 60_000);
  const messagingTimer = setInterval(runMessagingCycle, messagingIntervalMs);
  messagingTimer.unref();

  const server = http.createServer(async (request, response) => {
    const requestId = requestIdFrom(request);
    const startedAt = process.hrtime.bigint();
    const ip = requestIp(request, trustProxy);
    response.setHeader("x-request-id", requestId);
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("referrer-policy", "no-referrer");
    if (env.NODE_ENV === "production") {
      response.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
    }
    response.once("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      writeLog(logger, "info", "http_request", {
        requestId,
        method: request.method,
        path: request.url?.split("?", 1)[0] ?? "/",
        statusCode: response.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        ip
      });
    });

    try {
      const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
      const rate = rateLimiter.consume(ip);
      response.setHeader("x-ratelimit-limit", String(rate.limit));
      response.setHeader("x-ratelimit-remaining", String(rate.remaining));
      response.setHeader("x-ratelimit-reset", String(Math.ceil(rate.resetAt / 1_000)));
      if (!rate.allowed) {
        response.setHeader("retry-after", String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1_000))));
        return sendJson(response, 429, {
          error: "rate_limited",
          message: "There are too many requests right now. Please wait a moment and try again.",
          requestId
        });
      }

      const isWebhook = url.pathname.startsWith("/webhook/");
      if (isWebhook && webhookSecret) {
        if (!secretsMatch(webhookSecret, request.headers["x-retell-webhook-secret"])) {
          writeLog(logger, "warn", "webhook_auth_failed", { requestId, path: url.pathname, ip });
          return sendJson(response, 401, {
            error: "unauthorized",
            message: "I could not verify this call request. Please ask the salon team for help.",
            requestId
          });
        }
      } else if (isWebhook) {
        writeLog(logger, "warn", "unauthenticated_webhook_accepted", {
          requestId,
          path: url.pathname,
          ip,
          message: "RETELL_WEBHOOK_SECRET is unset. This webhook request was accepted without authentication."
        });
      }

      if (request.method === "GET" && url.pathname === "/health") {
        const inferred = await sweepNoShows();
        return sendJson(response, 200, {
          status: "ok",
          database: opened.driver,
          calendarProvider: calendar.provider,
          noShowsInferredThisRequest: inferred.length,
          requestId
        });
      }

      const method = routes.get(url.pathname);
      if (request.method !== "POST" || !method) {
        return sendJson(response, 404, {
          error: "not_found",
          message: "That API endpoint does not exist.",
          requestId
        });
      }

      const body = await readJson(request);
      const tenantId = tenantIdFromRequest(body, url, env);
      const result = await service[method](tenantId, body);
      return sendJson(response, 200, result);
    } catch (error) {
      writeLog(logger, "error", "http_request_failed", {
        requestId,
        method: request.method,
        path: request.url?.split("?", 1)[0] ?? "/",
        message: error.message,
        errorCode: error.code ?? null
      });
      const isSafeClientError = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500;
      return sendJson(response, isSafeClientError ? error.statusCode : 500, {
        error: isSafeClientError ? "invalid_request" : "internal_error",
        message: isSafeClientError
          ? error.message
          : "The request could not be completed safely. Please ask the salon team for help.",
        requestId
      });
    }
  });

  server.requestTimeout = positiveInteger(env.HTTP_REQUEST_TIMEOUT_MS, 15_000);
  server.headersTimeout = positiveInteger(env.HTTP_HEADERS_TIMEOUT_MS, 10_000);
  server.keepAliveTimeout = positiveInteger(env.HTTP_KEEP_ALIVE_TIMEOUT_MS, 5_000);

  let closePromise = null;
  return {
    db: opened.db,
    databaseDriver: opened.driver,
    calendar,
    dispatcher,
    service,
    server,
    seeded: opened.seeded,
    dataDir,
    sweepNoShows,
    runMessagingCycle,
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        const listenArgs = socketPath ? [socketPath] : [port, host];
        server.listen(...listenArgs, () => {
          server.off("error", reject);
          resolve();
        });
      });
      if (socketPath) return "http://localhost";
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      return `http://${host}:${actualPort}`;
    },
    async close() {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        clearInterval(sweepTimer);
        clearInterval(messagingTimer);
        try {
          if (server.listening) {
            await new Promise((resolve, reject) => {
              const forceTimer = setTimeout(() => server.closeAllConnections?.(), 10_000);
              server.close((error) => {
                clearTimeout(forceTimer);
                if (error) reject(error);
                else resolve();
              });
              server.closeIdleConnections?.();
            });
          }
        } finally {
          await opened.db.close();
        }
      })();
      return closePromise;
    }
  };
}

async function main() {
  const runtime = await createRuntime();
  const baseUrl = await runtime.start();
  writeLog(console, "info", "server_listening", {
    baseUrl,
    port: runtime.server.address()?.port ?? process.env.PORT ?? 3000,
    databaseDriver: runtime.databaseDriver,
    calendarProvider: runtime.calendar.provider,
    seeded: runtime.seeded
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    writeLog(console, "info", "graceful_shutdown_started", { signal });
    try {
      await runtime.close();
      writeLog(console, "info", "graceful_shutdown_complete", { signal });
      process.exitCode = 0;
    } catch (error) {
      writeLog(console, "error", "graceful_shutdown_failed", { signal, message: error.message });
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    writeLog(console, "error", "server_start_failed", { message: error.message });
    process.exitCode = 1;
  });
}
