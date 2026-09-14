/**
 * Gop event thanh bar 1 giay.
 *
 * KY LUAT CHONG LOOKAHEAD (CLAUDE.md rang buoc #5, uu tien cao hon moi toi uu khac):
 * moi bar mang hai moc thoi gian khac nhau va KHONG duoc lan lon:
 *
 *   bar_ts       — giay ma du lieu THUOC VE (moc 12:00:03.000)
 *   available_at — thoi diem worker thuc su CHOT duoc bar nay (12:00:04.250)
 *
 * Backtest va feature engine PHAI loc theo `available_at <= now`, khong phai `bar_ts`.
 * Gan gia tri cua 12:00:04 vao quyet dinh tai 12:00:03 chinh la lookahead bias — ly do
 * pho bien nhat khien chien luoc dep tren backtest roi thua sach khi chay that.
 */

import { BAR, PRICE_SCALE, QTY_SCALE } from '../config/index.js';
import { notional, spreadBps, weightedMean } from '../lib/fixed.js';
import { log } from '../lib/logger.js';

export interface Bar1s {
  /** Giay ma du lieu thuoc ve. */
  readonly barTs: Date;
  /** Thoi diem bar duoc chot — dung cot nay de chong lookahead. */
  readonly availableAt: Date;

  // --- tu aggTrade ---
  readonly open: bigint | null;
  readonly high: bigint | null;
  readonly low: bigint | null;
  readonly close: bigint | null;
  /** Tong khoi luong (thang QTY_SCALE). */
  readonly volume: bigint;
  readonly trades: number;
  /** Khoi luong ben MUA chu dong (taker buy). Nguyen lieu CVD. */
  readonly takerBuyVol: bigint;
  /** Khoi luong ben BAN chu dong (taker sell). */
  readonly takerSellVol: bigint;
  /** VWAP trong giay, thang PRICE_SCALE. null neu khong co trade. */
  readonly vwap: bigint | null;
  /** Gia tri danh nghia da khop, thang PRICE_SCALE (USDT). */
  readonly quoteVolume: bigint;

  // --- tu bookTicker (anh chup cuoi giay) ---
  readonly bidPx: bigint | null;
  readonly bidQty: bigint | null;
  readonly askPx: bigint | null;
  readonly askQty: bigint | null;
  /** Spread trung binh trong giay, thang 1e4 don vi tren bps. */
  readonly spreadBpsAvg: bigint | null;
  readonly bookUpdates: number;

  // --- tu forceOrder ---
  /** Gia tri thanh ly vi the LONG trong giay (USDT, thang PRICE_SCALE). */
  readonly liqLongQuote: bigint;
  readonly liqShortQuote: bigint;
  readonly liqCount: number;
}

interface MutableBar {
  barTsMs: number;
  open: bigint | null;
  high: bigint | null;
  low: bigint | null;
  close: bigint | null;
  volume: bigint;
  trades: number;
  takerBuyVol: bigint;
  takerSellVol: bigint;
  pxQtySum: bigint;
  quoteVolume: bigint;
  bidPx: bigint | null;
  bidQty: bigint | null;
  askPx: bigint | null;
  askQty: bigint | null;
  spreadSum: bigint;
  spreadSamples: number;
  bookUpdates: number;
  liqLongQuote: bigint;
  liqShortQuote: bigint;
  liqCount: number;
}

function emptyBar(barTsMs: number): MutableBar {
  return {
    barTsMs,
    open: null, high: null, low: null, close: null,
    volume: 0n, trades: 0, takerBuyVol: 0n, takerSellVol: 0n,
    pxQtySum: 0n, quoteVolume: 0n,
    bidPx: null, bidQty: null, askPx: null, askQty: null,
    spreadSum: 0n, spreadSamples: 0, bookUpdates: 0,
    liqLongQuote: 0n, liqShortQuote: 0n, liqCount: 0,
  };
}

export interface AggregatorStats {
  readonly barsEmitted: number;
  readonly lateEvents: number;
  readonly emptyBars: number;
}

export class BarAggregator {
  #open = new Map<number, MutableBar>();
  #lastClosedSec = 0;
  #barsEmitted = 0;
  #lateEvents = 0;
  #emptyBars = 0;
  #timer: NodeJS.Timeout | null = null;

  constructor(private readonly onBar: (bar: Bar1s) => void) {}

  start(): void {
    // Chay 4 lan/giay de moc dong bar sat voi grace period, khong troi.
    this.#timer = setInterval(() => this.#closeDue(), 250);
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    this.#closeDue(Number.POSITIVE_INFINITY);
  }

  get stats(): AggregatorStats {
    return { barsEmitted: this.#barsEmitted, lateEvents: this.#lateEvents, emptyBars: this.#emptyBars };
  }

  #bucket(eventTimeMs: number): MutableBar | null {
    const sec = Math.floor(eventTimeMs / BAR.intervalMs);
    if (sec <= this.#lastClosedSec) {
      // Event den sau khi bar da chot. Khong sua bar da phat — se lam sai lech
      // du lieu ma downstream tuong la on dinh. Chi dem lai.
      this.#lateEvents += 1;
      return null;
    }
    let b = this.#open.get(sec);
    if (b === undefined) {
      b = emptyBar(sec * BAR.intervalMs);
      this.#open.set(sec, b);
    }
    return b;
  }

  addTrade(eventTimeMs: number, priceI: bigint, qtyI: bigint, buyerIsMaker: boolean): void {
    const b = this.#bucket(eventTimeMs);
    if (b === null) return;

    if (b.open === null) b.open = priceI;
    b.high = b.high === null || priceI > b.high ? priceI : b.high;
    b.low = b.low === null || priceI < b.low ? priceI : b.low;
    b.close = priceI;

    b.volume += qtyI;
    b.trades += 1;
    b.pxQtySum += priceI * qtyI;
    b.quoteVolume += notional(priceI, qtyI, QTY_SCALE);

    // m=true => ben mua la maker => nguoi BAN chu dong.
    if (buyerIsMaker) b.takerSellVol += qtyI;
    else b.takerBuyVol += qtyI;
  }

  addBookTicker(eventTimeMs: number, bidI: bigint, bidQtyI: bigint, askI: bigint, askQtyI: bigint): void {
    const b = this.#bucket(eventTimeMs);
    if (b === null) return;

    b.bidPx = bidI;
    b.bidQty = bidQtyI;
    b.askPx = askI;
    b.askQty = askQtyI;
    b.bookUpdates += 1;

    const s = spreadBps(bidI, askI);
    if (s !== null) {
      b.spreadSum += s;
      b.spreadSamples += 1;
    }
  }

  /** isLongLiquidation: lenh thanh ly side=SELL nghia la mot vi the LONG bi dong. */
  addLiquidation(eventTimeMs: number, quoteValue: bigint, isLongLiquidation: boolean): void {
    const b = this.#bucket(eventTimeMs);
    if (b === null) return;
    if (isLongLiquidation) b.liqLongQuote += quoteValue;
    else b.liqShortQuote += quoteValue;
    b.liqCount += 1;
  }

  /**
   * Chot moi bar da qua han. Ham nay la noi duy nhat sinh ra `available_at`.
   * @param nowMs cho phep ep dong toan bo khi shutdown
   */
  #closeDue(nowMs: number = Date.now()): void {
    const cutoffSec = Number.isFinite(nowMs)
      ? Math.floor((nowMs - BAR.latenessGraceMs) / BAR.intervalMs)
      : Number.POSITIVE_INFINITY;

    for (const [sec, b] of [...this.#open].sort((x, y) => x[0] - y[0])) {
      if (sec >= cutoffSec) continue;
      this.#open.delete(sec);
      this.#lastClosedSec = Math.max(this.#lastClosedSec, sec);

      if (b.trades === 0 && b.bookUpdates === 0 && b.liqCount === 0) {
        this.#emptyBars += 1;
        continue;
      }

      this.#barsEmitted += 1;
      this.onBar({
        barTs: new Date(b.barTsMs),
        availableAt: new Date(),
        open: b.open, high: b.high, low: b.low, close: b.close,
        volume: b.volume,
        trades: b.trades,
        takerBuyVol: b.takerBuyVol,
        takerSellVol: b.takerSellVol,
        vwap: weightedMean(b.pxQtySum, b.volume),
        quoteVolume: b.quoteVolume,
        bidPx: b.bidPx, bidQty: b.bidQty, askPx: b.askPx, askQty: b.askQty,
        spreadBpsAvg: b.spreadSamples > 0 ? b.spreadSum / BigInt(b.spreadSamples) : null,
        bookUpdates: b.bookUpdates,
        liqLongQuote: b.liqLongQuote,
        liqShortQuote: b.liqShortQuote,
        liqCount: b.liqCount,
      });
    }

    if (this.#open.size > 120) {
      log.warn('bar.backlog', { openBuckets: this.#open.size });
    }
  }
}

export { PRICE_SCALE, QTY_SCALE };
