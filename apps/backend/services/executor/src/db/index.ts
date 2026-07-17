import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getSettings } from "../config.js";
import * as schema from "./schema.js";

type ExecutorDb = PostgresJsDatabase<typeof schema>;

let sql: postgres.Sql | null = null;
let db: ExecutorDb | null = null;

export function getSql(): postgres.Sql {
  if (!sql) {
    const s = getSettings();
    sql = postgres({
      host: s.postgresHost,
      port: s.postgresPort,
      user: s.postgresUser,
      password: s.postgresPassword,
      database: s.postgresDatabase,
      max: 8,
    });
  }
  return sql;
}

export function getDb(): ExecutorDb {
  if (!db) {
    db = drizzle(getSql(), { schema });
  }
  return db;
}
