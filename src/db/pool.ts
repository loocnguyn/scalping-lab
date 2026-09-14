import pg from 'pg';
import { DB } from '../config/index.js';
import { log, errFields } from '../lib/logger.js';

/**
 * Postgres tra numeric ve duoi dang string mac dinh — dung vay, giu nguyen.
 * Ep sang float o day se pha huy chinh dieu ma toan bo lop fixed-point dang bao ve.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => v);

export const pool = new pg.Pool({
  connectionString: DB.url,
  max: DB.poolMax,
  statement_timeout: DB.statementTimeoutMs,
  application_name: 'scalping-lab-ingest',
  // Supabase yeu cau TLS. rejectUnauthorized=false vi chuoi chung chi cua pooler
  // khong nam trong store mac dinh cua Node.
  ssl: DB.url.includes('supabase.') ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (e: Error) => {
  log.error('pg.pool_error', errFields(e));
});

export async function pingDb(): Promise<void> {
  const r = await pool.query<{ now: string; version: string }>(
    'select now()::text as now, version() as version',
  );
  log.info('pg.connected', {
    now: r.rows[0]?.now,
    version: r.rows[0]?.version?.split(' ').slice(0, 2).join(' '),
  });
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
