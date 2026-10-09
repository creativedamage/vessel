import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { createDb } from "@vessel/db";
import { loadEnv } from "./env.ts";
import { buildApp } from "./app.ts";

loadDotenv({ path: path.resolve(import.meta.dirname, "../../../.env") });

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const app = await buildApp({ db, env });

const close = async () => {
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
app.log.info(`Vessel API on :${env.API_PORT} — OpenAPI docs at /docs`);
