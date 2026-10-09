import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createDb } from "./index.ts";
import { seedDemo } from "./seed-data.ts";

loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env") });

const db = createDb();
const summary = await seedDemo(db);
console.log(`Seeded "Grace Community Church" with ${summary.assetTags.length} assets.`);
console.log("Sign in (dev login) as admin@grace.example (Owner) or jordan@grace.example (Manager).");
await db.$disconnect();
