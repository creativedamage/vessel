import { execSync } from "node:child_process";
import path from "node:path";
import { config as loadEnv } from "dotenv";

/**
 * Bring the test database up to the latest migrations once per run (non-destructive).
 * Each test file then TRUNCATEs and re-seeds (see helpers.ts).
 */
export default function setup() {
  loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env") });
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://vessel:vessel@localhost:5432/vessel_test";
  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(import.meta.dirname, "../../../packages/db"),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
