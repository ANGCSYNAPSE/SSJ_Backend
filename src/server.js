import app from "./app.js";
import { env } from "./config/env.js";
import { assertDatabaseConnection } from "./config/database.js";

async function start() {
  try {
    await assertDatabaseConnection();
    console.log("Database connection established.");
  } catch (error) {
    console.error("Could not connect to the database:", error.message);
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port}`);
    console.log(`Swagger docs at http://localhost:${env.port}/api/docs`);
  });

  const shutdown = (signal) => {
    console.log(`\n${signal} received, shutting down.`);
    server.close(() => process.exit(0));
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();
