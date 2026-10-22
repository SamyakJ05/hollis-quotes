/**
 * One Drizzle instance for the whole app.
 *  - DATABASE_URL=postgres://...  -> node-postgres pool (Neon in production)
 *  - DATABASE_URL=pglite:./.pglite -> in-process Postgres (local dev / tests, no install needed)
 * Both speak the same Postgres dialect, so the schema and queries are identical.
 */
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

export function createDb(url: string): DB {
  if (url.startsWith("pglite:")) {
    const dir = url.slice("pglite:".length);
    const client = dir === "memory" ? new PGlite() : new PGlite(dir);
    return drizzlePglite(client, { schema }) as unknown as DB;
  }
  const pool = new Pool({ connectionString: url, max: 5 });
  return drizzlePg(pool, { schema });
}

const g = globalThis as unknown as { __db?: DB };

export function getDb(): DB {
  if (!g.__db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__db = createDb(url);
  }
  return g.__db;
}

export { schema };
