import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getDatabaseSettings } from "../../config/database.js";
import * as mediaSchema from "./media-schema.js";
import * as runtimeSchema from "./schema.js";

const schema = { ...runtimeSchema, ...mediaSchema };
type RuntimeDb = PostgresJsDatabase<typeof schema>;

let sql: postgres.Sql | null = null;
let db: RuntimeDb | null = null;

export function getSql(): postgres.Sql {
  if (!sql) {
    const s = getDatabaseSettings();
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

export function getDb(): RuntimeDb {
  if (!db) {
    db = drizzle(getSql(), { schema });
  }
  return db;
}

export async function closeSql(): Promise<void> {
  const current = sql;
  sql = null;
  db = null;
  if (current) await current.end({ timeout: 5 });
}
