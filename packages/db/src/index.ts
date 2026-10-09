import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";

export * from "./generated/prisma/client.ts";
export { Prisma } from "./generated/prisma/client.ts";

export type Db = InstanceType<typeof PrismaClient>;

/** Create a Prisma client bound to a Postgres URL (Prisma 7 driver-adapter style). */
export function createDb(connectionString = process.env.DATABASE_URL): Db {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
