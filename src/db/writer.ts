/**
 * Ghi theo lo. Bar 1 giay nghia la 86.4k dong/ngay — insert tung dong la lang phi
 * round-trip va lam worker de bi chan khi mang cham. Gom lai, flush theo chu ky.
 *
 * Nguyen tac: KHONG BAO GIO chan luong doc WebSocket vi DB cham. Neu hang doi day
 * qua nguong, ta ghi log va bo dong cu nhat — mat vai bar con hon mat ket noi
 * (uptime la tieu chi Cua 1).
 */

import { pool } from './pool.js';
import { DB, PRICE_SCALE, QTY_SCALE, SYMBOL } from '../config/index.js';
import { formatFixed } from '../lib/fixed.js';
import { log, errFields } from '../lib/logger.js';
import type { Bar1s } from '../bar/aggregator.js';
import type { Sink } from './sink.js';

export interface LiquidationRow {
  readonly eventTs: Date;
  readonly availableAt: Date;
  readonly orderSide: 'BUY' | 'SELL';
  readonly isLongLiq: boolean;
  readonly priceI: bigint;
  readonly qtyI: bigint;
  readonly quoteI: bigint;
}

const BAR_COLUMNS = [
  'symbol', 'bar_ts', 'available_at', 'open', 'high', 'low', 'close', 'vwap',
  'volume', 'quote_volume', 'trades', 'taker_buy_vol', 'taker_sell_vol',
  'bid_px', 'bid_qty', 'ask_px', 'ask_qty', 'spread_bps_avg', 'book_updates',
  'liq_long_quote', 'liq_short_quote', 'liq_count',
] as const;

/** pg gioi han 65535 tham so mot cau lenh. Chia lo de khong cham tran. */
const BAR_CHUNK = Math.floor(60_000 / BAR_COLUMNS.length);

/** Sinh "($1,$2,...),($n,...)" theo so cot — dem tay la cho de sai nhat o day. */
function placeholders(rows: number, cols: number): string {
  const tuples: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    const slots: string[] = [];
    for (let c = 1; c <= cols; c += 1) slots.push(`$${r * cols + c}`);
    tuples.push(`(${slots.join(',')})`);
  }
  return tuples.join(',');
}

function px(v: bigint | null): string | null {
  return v === null ? null : formatFixed(v, PRICE_SCALE);
}
function qty(v: bigint | null): string | null {
  return v === null ? null : formatFixed(v, QTY_SCALE);
}

export class BatchWriter implements Sink {
  #bars: Bar1s[] = [];
  #liqs: LiquidationRow[] = [];
  #timer: NodeJS.Timeout | null = null;
  #flushing = false;
  #barsWritten = 0;
  #dropped = 0;

  get barsWritten(): number { return this.#barsWritten; }
  get queueDepth(): number { return this.#bars.length + this.#liqs.length; }
  get dropped(): number { return this.#dropped; }

  start(): void {
    this.#timer = setInterval(() => {
      void this.flush();
    }, DB.flushIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    await this.flush();
  }

  enqueueBar(bar: Bar1s): void {
    this.#bars.push(bar);
    if (this.#bars.length > DB.maxQueueSize) {
      const drop = this.#bars.length - DB.maxQueueSize;
      this.#bars.splice(0, drop);
      this.#dropped += drop;
      log.error('db.queue_overflow', { dropped: drop, totalDropped: this.#dropped });
    }
  }

  enqueueLiquidation(row: LiquidationRow): void {
    this.#liqs.push(row);
  }

  async flush(): Promise<void> {
    if (this.#flushing) return;
    if (this.#bars.length === 0 && this.#liqs.length === 0) return;
    this.#flushing = true;

    const bars = this.#bars;
    const liqs = this.#liqs;
    this.#bars = [];
    this.#liqs = [];

    try {
      for (let i = 0; i < bars.length; i += BAR_CHUNK) {
        await this.#writeBars(bars.slice(i, i + BAR_CHUNK));
      }
      if (liqs.length > 0) await this.#writeLiquidations(liqs);
    } catch (e) {
      // Tra lai hang doi de thu o chu ky sau. Neu DB chet lau, queue_overflow se don.
      this.#bars = bars.concat(this.#bars);
      this.#liqs = liqs.concat(this.#liqs);
      log.error('db.flush_failed', { bars: bars.length, liqs: liqs.length, ...errFields(e) });
    } finally {
      this.#flushing = false;
    }
  }

  async #writeBars(batch: readonly Bar1s[]): Promise<void> {
    if (batch.length === 0) return;

    const values: unknown[] = [];
    for (const b of batch) {
      values.push(
        SYMBOL.toUpperCase(), b.barTs, b.availableAt,
        px(b.open), px(b.high), px(b.low), px(b.close), px(b.vwap),
        qty(b.volume), formatFixed(b.quoteVolume, PRICE_SCALE), b.trades,
        qty(b.takerBuyVol), qty(b.takerSellVol),
        px(b.bidPx), qty(b.bidQty), px(b.askPx), qty(b.askQty),
        b.spreadBpsAvg === null ? null : formatFixed(b.spreadBpsAvg, 10_000n),
        b.bookUpdates,
        formatFixed(b.liqLongQuote, PRICE_SCALE),
        formatFixed(b.liqShortQuote, PRICE_SCALE),
        b.liqCount,
      );
    }

    await pool.query(
      `insert into market.bars_1s (${BAR_COLUMNS.join(', ')})
       values ${placeholders(batch.length, BAR_COLUMNS.length)}
       on conflict (symbol, bar_ts) do nothing`,
      values,
    );
    this.#barsWritten += batch.length;
  }

  async #writeLiquidations(batch: readonly LiquidationRow[]): Promise<void> {
    const cols = 8;
    const values: unknown[] = [];
    for (const l of batch) {
      values.push(
        l.eventTs, l.availableAt, SYMBOL.toUpperCase(), l.orderSide, l.isLongLiq,
        formatFixed(l.priceI, PRICE_SCALE), formatFixed(l.qtyI, QTY_SCALE),
        formatFixed(l.quoteI, PRICE_SCALE),
      );
    }
    await pool.query(
      `insert into market.liquidations
         (event_ts, available_at, symbol, order_side, is_long_liq, price, qty, quote_value)
       values ${placeholders(batch.length, cols)}`,
      values,
    );
  }
}
