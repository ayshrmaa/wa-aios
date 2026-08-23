import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./src/database.mjs";
import { MessageDispatcher } from "./src/dispatcher.mjs";
import { createTransport } from "./src/transport.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function log(level, event, details = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details
  }));
}

async function main() {
  const dataDir = process.env.PGLITE_DATA_DIR ?? path.join(here, "data", "pglite");
  const opened = await openDatabase({
    dataDir,
    databaseUrl: process.env.DATABASE_URL,
    env: process.env,
    logger: console,
    seed: true
  });
  try {
    const dispatcher = new MessageDispatcher({
      db: opened.db,
      transport: createTransport({ env: process.env, logger: console }),
      logger: console,
      env: process.env
    });
    const result = await dispatcher.runOnce();
    log("info", "worker_complete", { databaseDriver: opened.driver, ...result });
  } finally {
    await opened.db.close();
  }
}

main().catch((error) => {
  log("error", "worker_failed", { message: error.message });
  process.exitCode = 1;
});

