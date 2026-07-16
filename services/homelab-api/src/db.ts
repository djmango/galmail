import { SQL } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Database = SQL;

export function createDatabase(databaseUrl: string): Database {
  return new SQL(databaseUrl);
}

export async function migrate(db: Database): Promise<void> {
  const schemaPath = join(import.meta.dir, "schema.sql");
  const schema = readFileSync(schemaPath, "utf8");
  await db.unsafe(schema);
}

export async function purgeExpiredInputs(db: Database): Promise<number> {
  const result = await db`
    DELETE FROM retained_inputs WHERE expires_at <= NOW()
  `;
  return result.count ?? 0;
}
