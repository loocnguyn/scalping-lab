/** Chay lan luot cac file trong db/migrations theo thu tu ten. Idempotent. */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import 'dotenv/config';

const url = process.env['DATABASE_URL'];
if (url === undefined || url === '') throw new Error('Thieu DATABASE_URL');

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes('supabase.') ? { rejectUnauthorized: false } : undefined,
});

await client.connect();
await client.query(`create table if not exists ops_migrations (
  name text primary key, applied_at timestamptz not null default now())`);
// Bang nay nam o schema public nen PostgREST phoi bay no ra ngoai. Bat RLS khong
// policy = chan sach anon; worker ket noi truc tiep bang role postgres nen khong bi
// anh huong. Khong lam buoc nay thi tren DB moi, advisor bao loi muc ERROR ngay.
await client.query('alter table ops_migrations enable row level security');

const dir = join(process.cwd(), 'db', 'migrations');
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

for (const f of files) {
  const done = await client.query('select 1 from ops_migrations where name = $1', [f]);
  if (done.rowCount !== null && done.rowCount > 0) {
    console.log(`- bo qua ${f} (da chay)`);
    continue;
  }
  const sql = await readFile(join(dir, f), 'utf8');
  console.log(`> chay ${f} ...`);
  await client.query('begin');
  try {
    await client.query(sql);
    await client.query('insert into ops_migrations (name) values ($1)', [f]);
    await client.query('commit');
    console.log(`  OK ${f}`);
  } catch (e) {
    await client.query('rollback');
    console.error(`  LOI ${f}:`, e instanceof Error ? e.message : e);
    process.exitCode = 1;
    break;
  }
}

await client.end();
