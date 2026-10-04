import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, statement_timeout: 60000 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(718227831)');
  const directory = new URL('./migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((f) => /^\d+_[a-z_]+\.sql$/.test(f)).sort();
  const exists = await client.query("SELECT to_regclass('public.schema_migrations') AS table_name");
  const versions = exists.rows[0]?.table_name
    ? (await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version)
    : [];
  for (const file of files) {
    if (versions.includes(Number(file.split('_')[0]))) continue;
    await client.query(await readFile(new URL(file, directory), 'utf8'));
  }
  await client.query('COMMIT');
  process.stdout.write('Database migrations applied.\n');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
