import type { PoolClient, QueryResultRow } from "pg";
import { getPostgresPool, query } from "../agent/lib/postgres";

export { getPostgresPool, query };

export async function clientQuery<T extends QueryResultRow>(
  client: PoolClient,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await client.query<T>(text, values);
  return result.rows;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // The original error is the one callers need.
    }
    throw error;
  } finally {
    client.release();
  }
}
