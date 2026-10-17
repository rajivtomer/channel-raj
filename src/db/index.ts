import "server-only";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

type Db = ReturnType<typeof import("drizzle-orm/postgres-js").drizzle<typeof schema>>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    // postgres-js forwards unknown URL params to the server; Neon's channel_binding is a libpq-only option.
    const clean = new URL(url);
    clean.searchParams.delete("channel_binding");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const postgres = (await import("postgres")).default;
    const db = drizzle(postgres(clean.toString(), { max: 10, prepare: false }), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return db;
  }
  // No DATABASE_URL: use an embedded Postgres (PGlite) on disk for local development.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = path.join(process.cwd(), ".data", "pglite");
  fs.mkdirSync(dir, { recursive: true });
  const db = drizzle(new PGlite(dir), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  // Both drivers expose the same query builder API.
  return db as unknown as Db;
}

const globalForDb = globalThis as unknown as { __db?: Promise<Db> };

export function getDb(): Promise<Db> {
  globalForDb.__db ??= connect();
  return globalForDb.__db;
}

export { schema };
