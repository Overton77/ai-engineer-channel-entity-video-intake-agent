import { Pool, type QueryResultRow } from "pg";

let pool: Pool | undefined;

function postgresConfig() {
  const raw = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!raw) {
    throw new Error("POSTGRES_URL or POSTGRES_URL_NON_POOLING is not set");
  }

  const url = new URL(raw);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("supa");

  return {
    connectionString: url.toString(),
    max: 4,
    ssl: { rejectUnauthorized: false },
  };
}

export function getPostgresPool(): Pool {
  if (pool) return pool;
  pool = new Pool(postgresConfig());
  return pool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await getPostgresPool().query<T>(text, values);
  return result.rows;
}
