/**
 * Bao cao Cua 1: da chay lien tuc bao lau, mat ket noi bao nhieu, co du lieu thung khong.
 * Chay: npm run uptime
 */
import pg from 'pg';
import 'dotenv/config';

const url = process.env['DATABASE_URL'];
if (url === undefined || url === '') throw new Error('Thieu DATABASE_URL');

const c = new pg.Client({
  connectionString: url,
  ssl: url.includes('supabase.') ? { rejectUnauthorized: false } : undefined,
});
await c.connect();

const span = await c.query<{ first: string; last: string; n: string }>(
  `select min(bar_ts)::text as first, max(bar_ts)::text as last, count(*)::text as n
   from market.bars_1s`,
);
const row = span.rows[0];
console.log('\n=== BAR 1 GIAY ===');
console.log('So bar   :', row?.n ?? '0');
console.log('Tu       :', row?.first ?? '-');
console.log('Den      :', row?.last ?? '-');

if (row !== undefined && row.first !== null && row.last !== null) {
  const gaps = await c.query<{ gap_start: string; gap_sec: string }>(
    `select (bar_ts)::text as gap_start,
            extract(epoch from (lead(bar_ts) over (order by bar_ts) - bar_ts))::text as gap_sec
     from market.bars_1s
     order by bar_ts`,
  );
  const holes = gaps.rows.filter((g) => Number(g.gap_sec) > 5);
  console.log('Lo hong  :', holes.length, '(khoang trong > 5 giay)');
  for (const h of holes.slice(0, 10)) {
    console.log(`  - ${h.gap_start} thieu ${Math.round(Number(h.gap_sec))}s`);
  }
}

console.log('\n=== DO BEN KET NOI ===');
const up = await c.query(`select * from ops_uptime_24h`);
console.table(up.rows);

const ev = await c.query(
  `select at::text, kind, downtime_ms, reason
   from ops_connection_events order by at desc limit 10`,
);
console.log('\n10 su kien ket noi gan nhat:');
console.table(ev.rows);

console.log('\n=== THANH LY ===');
const liq = await c.query<{ n: string; longs: string; shorts: string }>(
  `select count(*)::text as n,
          coalesce(sum(quote_value) filter (where is_long_liq), 0)::text as longs,
          coalesce(sum(quote_value) filter (where not is_long_liq), 0)::text as shorts
   from market.liquidations`,
);
console.table(liq.rows);

await c.end();
