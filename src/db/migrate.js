import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { env } from "../config/env.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Migrations use a regular Postgres connection rather than the Neon HTTP
 * driver the app uses at runtime: HTTP cannot run multi-statement SQL, and
 * each file needs to apply atomically inside a transaction.
 */
async function migrate() {
  // TLS settings come from the sslmode in DATABASE_URL; Neon presents a
  // publicly trusted certificate, so full verification succeeds as-is.
  const client = new pg.Client({ connectionString: env.databaseUrl });

  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows } = await client.query("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((row) => row.name));

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    let count = 0;

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`- skipped ${file} (already applied)`);
        continue;
      }

      const contents = await readFile(join(migrationsDir, file), "utf8");

      // Each migration is all-or-nothing, so a failure halfway through cannot
      // leave the schema in a state the runner would then record as applied.
      await client.query("BEGIN");
      try {
        await client.query(contents);
        await client.query(
          "INSERT INTO schema_migrations (name) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`${file}: ${error.message}`);
      }

      console.log(`+ applied ${file}`);
      count += 1;
    }

    console.log(
      count === 0
        ? "Schema already up to date."
        : `Applied ${count} migration(s).`,
    );
  } finally {
    await client.end();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Migration failed:", error.message);
    process.exit(1);
  });
