import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

import { getSettings } from "../config.js";
import * as schema from "./schema.js";

type ChatDb = MySql2Database<typeof schema>;

let pool: mysql.Pool | null = null;
let db: ChatDb | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    const s = getSettings();
    pool = mysql.createPool({
      host: s.mysqlHost,
      port: s.mysqlPort,
      user: s.mysqlUser,
      password: s.mysqlPassword,
      database: s.mysqlDatabase,
      connectionLimit: 8,
    });
  }
  return pool;
}

export function getDb(): ChatDb {
  if (!db) {
    db = drizzle(getPool(), { schema, mode: "default" });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
