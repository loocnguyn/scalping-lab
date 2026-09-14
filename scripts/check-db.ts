/**
 * Kiem tra ket noi DB va bao chinh xac dang vuong o dau.
 *
 * Viet rieng script nay vi loi ket noi Postgres qua Supabase pooler thuong bao rat
 * lech tam: mat khau co ky tu dac biet chua escape se ra "getaddrinfo ENOTFOUND",
 * nghe nhu loi mang chu khong phai loi mat khau. Doan truoc va noi thang ra.
 */
import 'dotenv/config';
import pg from 'pg';

function mask(url: string): string {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
}

const pwd = process.env['SUPABASE_DB_PASSWORD'];
const direct = process.env['DATABASE_URL'];

if ((pwd === undefined || pwd === '') && (direct === undefined || direct === '')) {
  console.error('\n[X] Chua co mat khau DB.\n');
  console.error('    Mo:  https://supabase.com/dashboard/project/fedhavhjkmsweyhsxkkk/settings/database');
  console.error('    -> "Reset database password" -> copy -> dan vao SUPABASE_DB_PASSWORD trong .env\n');
  process.exit(1);
}

// Import dong: src/config nem loi ngay luc import neu thieu chuoi ket noi, se nuot
// mat thong bao huong dan o tren.
const { DB } = await import('../src/config/index.js');

console.log('Ket noi toi :', mask(DB.url));

const client = new pg.Client({
  connectionString: DB.url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  const v = await client.query<{ v: string; db: string; usr: string }>(
    'select version() as v, current_database() as db, current_user as usr',
  );
  const r = v.rows[0];
  console.log('[OK] Ket noi thanh cong');
  console.log('     postgres  :', r?.v.split(' ').slice(0, 2).join(' '));
  console.log('     database  :', r?.db);
  console.log('     user      :', r?.usr);

  // Kiem tra lai bang co san chua, va quyen ghi co that su dung khong.
  const t = await client.query<{ tbl: string; n: string }>(`
    select 'market.bars_1s' as tbl, count(*)::text as n from market.bars_1s
    union all select 'market.liquidations', count(*)::text from market.liquidations
    union all select 'signals', count(*)::text from signals
    union all select 'signal_outcomes', count(*)::text from signal_outcomes
    union all select 'setup_stats', count(*)::text from setup_stats
  `);
  console.log('\n     Bang hien co:');
  for (const row of t.rows) console.log(`       ${row.tbl.padEnd(22)} ${row.n.padStart(8)} dong`);

  // Thu ghi that roi xoa — quyen SELECT khong dam bao quyen INSERT.
  await client.query('begin');
  await client.query(
    `insert into market.bars_1s (bar_ts, available_at, close, trades)
     values ('1970-01-01T00:00:00Z', '1970-01-01T00:00:01Z', 1.00, 0)`,
  );
  await client.query('rollback');
  console.log('\n[OK] Quyen ghi xac nhan (da insert thu va rollback)');
  console.log('\n     San sang. Chay:  npm run dev\n');
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('\n[X] Ket noi that bai:', msg, '\n');
  if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
    console.error('    Loi nay THUONG KHONG phai do mang.');
    console.error('    Neu ban dan nguyen chuoi vao DATABASE_URL va mat khau co ky tu @ ? # / :');
    console.error('    thi URL bi cat sai cho. Cach chac an: xoa DATABASE_URL di, chi dien');
    console.error('    SUPABASE_DB_PASSWORD — code se tu escape.\n');
  } else if (msg.includes('password') || msg.includes('authentication')) {
    console.error('    Sai mat khau. Vao dashboard reset lai roi dan cai moi.\n');
  } else if (msg.includes('timeout')) {
    console.error('    Project co the dang o trang thai paused. Mo dashboard de danh thuc.\n');
  }
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
