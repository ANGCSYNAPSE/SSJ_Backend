import { neon } from "@neondatabase/serverless";
import { env } from "./env.js";

/**
 * Neon's serverless driver over HTTP. Used as a tagged template so values are
 * always sent as bound parameters — never interpolated into SQL text.
 *
 *   const rows = await sql`SELECT * FROM users WHERE email = ${email}`;
 */
export const sql = neon(env.databaseUrl);

/** Verifies connectivity at boot so a bad DATABASE_URL fails loudly. */
export async function assertDatabaseConnection() {
  const [row] = await sql`SELECT NOW() AS now`;
  return row.now;
}
