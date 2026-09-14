/**
 * Dinh tuyen message tho tu WebSocket vao aggregator + writer.
 * Moi payload deu qua type guard truoc — du lieu tu mang khong duoc tin cau truc.
 */

import { PRICE_SCALE, QTY_SCALE } from '../config/index.js';
import { parseFixed, notional } from '../lib/fixed.js';
import { log } from '../lib/logger.js';
import { isBookTicker, isForceOrder, isTrade } from '../types/binance.js';
import type { BarAggregator } from '../bar/aggregator.js';
import type { Sink } from '../db/sink.js';
import type { UptimeTracker } from '../health/uptime.js';
import type { StreamHealth } from '../ws/stream-health.js';
import type { FeatureEngine } from '../features/engine.js';

export interface RouterCounters {
  trades: number;
  bookTickers: number;
  forceOrders: number;
  depthUpdates: number;
  unknown: number;
  malformed: number;
}

export class StreamRouter {
  readonly counters: RouterCounters = {
    trades: 0, bookTickers: 0, forceOrders: 0, depthUpdates: 0, unknown: 0, malformed: 0,
  };

  constructor(
    private readonly agg: BarAggregator,
    private readonly writer: Sink,
    private readonly uptime: UptimeTracker,
    private readonly health: StreamHealth,
    private readonly features: FeatureEngine,
  ) {}

  handle = (stream: string, data: unknown): void => {
    this.health.mark(stream);
    try {
      if (stream.endsWith('@trade')) this.#trade(data);
      else if (stream.endsWith('@bookTicker')) this.#bookTicker(data);
      else if (stream.endsWith('@forceOrder')) this.#forceOrder(data);
      else if (stream.includes('@depth')) this.#depth(data);
      else this.counters.unknown += 1;
    } catch (e) {
      this.counters.malformed += 1;
      if (this.counters.malformed % 100 === 1) {
        log.warn('router.malformed', { stream, count: this.counters.malformed });
      }
    }
  };

  #trade(data: unknown): void {
    if (!isTrade(data)) { this.counters.malformed += 1; return; }
    this.counters.trades += 1;
    this.agg.addTrade(
      data.T,
      parseFixed(data.p, PRICE_SCALE),
      parseFixed(data.q, QTY_SCALE),
      data.m,
    );
  }

  #bookTicker(data: unknown): void {
    if (!isBookTicker(data)) { this.counters.malformed += 1; return; }
    this.counters.bookTickers += 1;
    // bookTicker co ca E (event time) va T (transaction time); T sat thuc te hon.
    const ts = typeof data.T === 'number' ? data.T : data.E;
    this.agg.addBookTicker(
      ts,
      parseFixed(data.b, PRICE_SCALE),
      parseFixed(data.B, QTY_SCALE),
      parseFixed(data.a, PRICE_SCALE),
      parseFixed(data.A, QTY_SCALE),
    );
  }

  /**
   * @depth20@100ms -> feature book_imb (tong khoi luong 20 muc bid / 20 muc ask).
   * Chi giu gia tri moi nhat trong bo nho, khong ghi DB: 10 ban tin/giay x 40 muc
   * la nhieu du lieu ma Tuan 1 chua dung den.
   */
  #depth(data: unknown): void {
    if (typeof data !== 'object' || data === null) { this.counters.malformed += 1; return; }
    const o = data as Record<string, unknown>;
    const bids = o['b'];
    const asks = o['a'];
    if (!Array.isArray(bids) || !Array.isArray(asks)) { this.counters.malformed += 1; return; }

    const sum = (levels: unknown[]): number => {
      let t = 0;
      for (const lv of levels) {
        if (!Array.isArray(lv) || lv.length < 2) continue;
        const q = Number(lv[1]);
        if (Number.isFinite(q)) t += q;
      }
      return t;
    };
    this.counters.depthUpdates += 1;
    this.features.setBookImbalance(sum(bids), sum(asks));
  }

  #forceOrder(data: unknown): void {
    if (!isForceOrder(data)) { this.counters.malformed += 1; return; }
    this.counters.forceOrders += 1;
    this.uptime.countLiquidation();

    const o = data.o;
    // ap = gia khop trung binh; rong thi lui ve gia lenh.
    const priceI = parseFixed(o.ap !== '0' ? o.ap : o.p, PRICE_SCALE);
    const qtyI = parseFixed(o.q, QTY_SCALE);
    const quoteI = notional(priceI, qtyI, QTY_SCALE);

    // side=SELL nghia la lenh ban ep buoc => mot vi the LONG dang bi thanh ly.
    const isLongLiq = o.S === 'SELL';

    this.agg.addLiquidation(o.T, quoteI, isLongLiq);
    this.writer.enqueueLiquidation({
      eventTs: new Date(o.T),
      availableAt: new Date(),
      orderSide: o.S,
      isLongLiq,
      priceI, qtyI, quoteI,
    });
  }
}
