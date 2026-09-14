/**
 * Logger JSON mot dong. Du de grep va dem uptime, khong keo them phu thuoc.
 */
import { LOG_LEVEL } from '../config/index.js';

const ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof ORDER;

const threshold = ORDER[LOG_LEVEL] ?? ORDER.info;

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg,
    ...fields,
  });
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit('debug', msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit('info', msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit('warn', msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit('error', msg, f),
};

/** Rut gon Error thanh field log duoc, khong nuot stack. */
export function errFields(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    return { err: e.message, errName: e.name, stack: e.stack?.split('\n').slice(0, 4).join(' | ') };
  }
  return { err: String(e) };
}
