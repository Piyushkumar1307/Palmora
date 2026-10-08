import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createCloudinaryService } from "./lib/cloudinary.js";
import { loadConfig } from "./lib/config.js";
import { createReadingService } from "./lib/reading.js";

const config = loadConfig();
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staticDirectory = path.join(projectRoot, "dist");
const app = createApp({
  config,
  cloudinaryService: createCloudinaryService(config),
  readingService: createReadingService(config),
  staticDirectory: existsSync(staticDirectory) ? staticDirectory : undefined
});

const server = app.listen(config.port, () => {
  console.info(`AI Palm Reader API listening on port ${config.port}`);
});

function shutDown(signal) {
  console.info(`${signal} received; closing API server.`);
  server.close((error) => {
    if (error) {
      console.error("Server shutdown failed", { name: error.name, message: error.message });
      process.exitCode = 1;
    }
    process.exit();
  });
}

process.once("SIGINT", () => shutDown("SIGINT"));
process.once("SIGTERM", () => shutDown("SIGTERM"));
