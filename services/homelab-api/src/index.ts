import { loadConfig } from "./config.js";
import { createDatabase, migrate } from "./db.js";
import { createHomelabApp } from "./server.js";

const config = loadConfig();
const db = createDatabase(config.databaseUrl);

await migrate(db);

const app = createHomelabApp(config, db);

export default {
  port: config.port,
  fetch: app.fetch,
};
