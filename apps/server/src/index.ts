import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./shared/logger/logger.js";

const app = createApp();

const server = app.listen(env.SERVER_PORT, () => {
  logger.info(`Server listening on port ${env.SERVER_PORT} (${env.NODE_ENV})`);
  logger.info(`API docs available at http://localhost:${env.SERVER_PORT}${env.API_BASE_PATH}/docs`);
});

function shutdown(signal: string): void {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
