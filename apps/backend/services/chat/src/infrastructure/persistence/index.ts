import postgres from "postgres";

import { getSettings } from "../../bootstrap/config.js";

let client: postgres.Sql | undefined;

export function getSql(): postgres.Sql {
  if (!client) {
    const settings = getSettings();
    client = postgres({
      host: settings.postgresHost,
      port: settings.postgresPort,
      user: settings.postgresUser,
      password: settings.postgresPassword,
      database: settings.postgresDatabase,
      max: 8,
    });
  }
  return client;
}

export async function closeSql(): Promise<void> {
  if (!client) return;
  const current = client;
  client = undefined;
  await current.end();
}
