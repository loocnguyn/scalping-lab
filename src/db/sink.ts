/**
 * Dich den cua bar. Hai ban cai: ghi Postgres that, va ban chay thu in ra stdout.
 * Tach ra de duong ingest + gop bar kiem chung duoc doc lap voi DB.
 */
import type { Bar1s } from '../bar/aggregator.js';
import type { LiquidationRow } from './writer.js';
import { PRICE_SCALE, QTY_SCALE } from '../config/index.js';
import { formatFixed } from '../lib/fixed.js';

export interface Sink {
  start(): void;
  stop(): Promise<void>;
  enqueueBar(bar: Bar1s): void;
  enqueueLiquidation(row: LiquidationRow): void;
  readonly barsWritten: number;
  readonly queueDepth: number;
  readonly dropped: number;
}

export class DryRunSink implements Sink {
  #n = 0;
  start(): void {}
  async stop(): Promise<void> {}
  get barsWritten(): number { return this.#n; }
  get queueDepth(): number { return 0; }
  get dropped(): number { return 0; }

  enqueueBar(b: Bar1s): void {
    this.#n += 1;
    const lagMs = b.availableAt.getTime() - b.barTs.getTime();
    process.stdout.write(JSON.stringify({
      t: 'bar',
      barTs: b.barTs.toISOString(),
      availableAt: b.availableAt.toISOString(),
      lagMs,
      o: b.open === null ? null : formatFixed(b.open, PRICE_SCALE),
      h: b.high === null ? null : formatFixed(b.high, PRICE_SCALE),
      l: b.low === null ? null : formatFixed(b.low, PRICE_SCALE),
      c: b.close === null ? null : formatFixed(b.close, PRICE_SCALE),
      vwap: b.vwap === null ? null : formatFixed(b.vwap, PRICE_SCALE),
      vol: formatFixed(b.volume, QTY_SCALE),
      trades: b.trades,
      takerBuy: formatFixed(b.takerBuyVol, QTY_SCALE),
      takerSell: formatFixed(b.takerSellVol, QTY_SCALE),
      spreadBps: b.spreadBpsAvg === null ? null : formatFixed(b.spreadBpsAvg, 10_000n),
      bookUpd: b.bookUpdates,
      liqLong: formatFixed(b.liqLongQuote, PRICE_SCALE),
      liqShort: formatFixed(b.liqShortQuote, PRICE_SCALE),
    }) + '\n');
  }

  enqueueLiquidation(l: LiquidationRow): void {
    process.stdout.write(JSON.stringify({
      t: 'liq',
      at: l.eventTs.toISOString(),
      side: l.orderSide,
      viThe: l.isLongLiq ? 'LONG bi thanh ly' : 'SHORT bi thanh ly',
      px: formatFixed(l.priceI, PRICE_SCALE),
      qty: formatFixed(l.qtyI, QTY_SCALE),
      usdt: formatFixed(l.quoteI, PRICE_SCALE),
    }) + '\n');
  }
}
