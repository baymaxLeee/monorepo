import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getDatabaseSettings, type Environment } from "../../bootstrap/database-config.js";
import * as mediaSchema from "./media-schema.js";
import * as runtimeSchema from "./schema.js";

const schema = { ...runtimeSchema, ...mediaSchema };
type RuntimeDb = PostgresJsDatabase<typeof schema>;

let sql: postgres.Sql | null = null;
let db: RuntimeDb | null = null;

export function getSql(): postgres.Sql {
  if (!sql) {
    const environment = (process.env.ENVIRONMENT ?? "development") as Environment;
    const s = getDatabaseSettings(environment);
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
