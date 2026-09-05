/**
 * The shared database handle.
 *
 * Next.js hot-reloads modules in development, which would otherwise open a new
 * connection pool on every save until Postgres refuses them. Caching the client
 * on globalThis keeps one pool across reloads.
 *
 * Re-exporting the schema means routes can `import { db, races } from "@/db"`
 * rather than reaching into two modules for every query.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
}

const globalForDb = globalThis as unknown as {
  __racingClient?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__racingClient ??
  postgres(process.env.DATABASE_URL, {
    max: 8,
    // Neon pools over TLS; postgres-js needs this on explicitly.
    ssl: process.env.DATABASE_URL.includes("localhost") ? false : "require",
  });

if (process.env.NODE_ENV !== "production") globalForDb.__racingClient = client;

export const db = drizzle(client, { schema });
export * from "./schema";
