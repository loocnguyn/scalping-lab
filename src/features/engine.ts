/**
 * Tinh 9 feature o muc 4 ke hoach, cuon chieu tren dong bar 1 giay.
 *
 * Moi snapshot mang `availableAt` — thoi diem thuc su tinh duoc. Signal engine chi duoc
 * dung snapshot tai dung thoi diem do, khong duoc nhin nguoc lai (rang buoc cung #5).
 *
 * Tang nay tinh bang so thuc. O DAY float chap nhan duoc vi la chi bao thong ke, khong
 * phai tien. Moi tinh toan P&L van chay tren so nguyen — src/lib/fixed.ts va
 * src/paper/broker.ts. Rang buoc "khong dung float cho tinh toan tien" duoc giu nguyen.
 */

import { PRICE_SCALE, QTY_SCALE, REGIME } from '../config/index.js';
import type { Bar1s } from '../bar/aggregator.js';
import { RollingPercentile } from './rolling.js';

const SEC = 1;
const MIN = 60 * SEC;

function toNum(v: bigint | null, scale: bigint): number | null {
  return v === null ? null : Number(v) / Number(scale);
}

export interface FeatureSnapshot {
  readonly barTs: Date;
  readonly availableAt: Date;
  readonly mid: number | null;
  /** Mat can bang dong lenh o dinh so lenh, cua so 10s. Feature manh nhat theo tai lieu. */
  readonly ofi10s: number | null;
  /** Chenh lech khoi luong taker mua - ban, 60s. */
  readonly cvd60s: number | null;
  readonly spreadBps: number | null;
  readonly spreadMedian1h: number | null;
  /** Do lech gia so voi VWAP 5 phut, chuan hoa theo ATR. */
  readonly vwapDev: number | null;
  readonly bookImb: number | null;
  readonly liqLong60s: number;
  readonly liqShort60s: number;
  readonly atr5mPct: number | null;
  /** Percentile cua atr5mPct so voi lich su — bo loc che do. */
  readonly atrPercentile: number | null;
  readonly fundingPct: number | null;
  readonly oiChg4h: number | null;
  readonly minutesToFunding: number | null;
  readonly range30mHigh: number | null;
  readonly range30mLow: number | null;
  readonly high15m: number | null;
  readonly low15m: number | null;
  readonly high4h: number | null;
  readonly vwap15m: number | null;
  /** Thi truong du bien dong de phat signal? Bo loc dung TRUOC moi rule. */
  readonly regimeOk: boolean;
  readonly regimeLabel: 'BIEN_DONG_CAO' | 'BIEN_DONG_THAP' | 'CHUA_DU_DU_LIEU';
}

interface BarLite {
  ts: number;
  close: number | null;
  high: number | null;
  low: number | null;
  vwap: number | null;
  volume: number;
  takerBuy: number;
  takerSell: number;
  bid: number | null;
  ask: number | null;
  bidQty: number | null;
  askQty: number | null;
  spread: number | null;
  liqLong: number;
  liqShort: number;
}

export class FeatureEngine {
  /** Vong dem bar 1 giay, giu ~4 gio. */
  #buf: BarLite[] = [];
  #maxBars = 4 * 3600 + 600;
  /**
   * Lich su atr5mPct de tinh percentile (bo loc che do).
   * Xem src/features/rolling.ts — cua so phai dung bang REGIME.atrLookbackDays,
   * ban truoc bi cap chan lam cua so thu con 2,31 ngay.
   */
  #atrHistory = new RollingPercentile({
    windowMs: REGIME.atrLookbackDays * 24 * 3600_000,
    sampleIntervalMs: REGIME.atrSampleIntervalMs,
    minSamples: REGIME.atrMinSamples,
  });
  #bookImb: number | null = null;

  /** Cap nhat book_imb tu @depth20@100ms — goi tu router. */
  setBookImbalance(bidVol: number, askVol: number): void {
    this.#bookImb = askVol > 0 ? bidVol / askVol : null;
  }

  push(b: Bar1s): void {
    this.#buf.push({
      ts: b.barTs.getTime(),
      close: toNum(b.close, PRICE_SCALE),
      high: toNum(b.high, PRICE_SCALE),
      low: toNum(b.low, PRICE_SCALE),
      vwap: toNum(b.vwap, PRICE_SCALE),
      volume: Number(b.volume) / Number(QTY_SCALE),
      takerBuy: Number(b.takerBuyVol) / Number(QTY_SCALE),
      takerSell: Number(b.takerSellVol) / Number(QTY_SCALE),
      bid: toNum(b.bidPx, PRICE_SCALE),
      ask: toNum(b.askPx, PRICE_SCALE),
      bidQty: toNum(b.bidQty, QTY_SCALE),
      askQty: toNum(b.askQty, QTY_SCALE),
      spread: b.spreadBpsAvg === null ? null : Number(b.spreadBpsAvg) / 10_000,
      liqLong: Number(b.liqLongQuote) / Number(PRICE_SCALE),
      liqShort: Number(b.liqShortQuote) / Number(PRICE_SCALE),
    });
    if (this.#buf.length > this.#maxBars) this.#buf.splice(0, this.#buf.length - this.#maxBars);
  }

  get barCount(): number {
    return this.#buf.length;
  }

  /**
   * Feature nao dang co gia tri, feature nao dang null.
   *
   * Vi sao can: S3 doi `bookImb !== null`, S2 doi `fundingPct` va `oiChg4h`. Neu mot
   * trong so do am tham null — parse sai payload depth20, REST loi, chua du lich su —
   * thi setup do KHONG BAO GIO kich hoat va log van xanh. Dung loai loi im lang nhu
   * stream chet ma van bao "OPEN". Phai nhin thay duoc thi moi sua duoc.
   */
  featureHealth(snap: FeatureSnapshot | null): Record<string, boolean> {
    if (snap === null) return { chuaCoSnapshot: false };
    return {
      mid: snap.mid !== null,
      ofi10s: snap.ofi10s !== null,
      cvd60s: snap.cvd60s !== null,
      spreadBps: snap.spreadBps !== null,
      bookImb: snap.bookImb !== null,
      atr5mPct: snap.atr5mPct !== null,
      atrPercentile: snap.atrPercentile !== null,
      vwapDev: snap.vwapDev !== null,
      range30m: snap.range30mHigh !== null,
      fundingPct: snap.fundingPct !== null,
      oiChg4h: snap.oiChg4h !== null,
    };
  }

  /** So mau ATR dang co va khoang thoi gian chung phu — de log va chan doan. */
  get atrHistoryStats(): { samples: number; spanHours: number; ready: boolean } {
    return {
      samples: this.#atrHistory.size,
      spanHours: Math.round((this.#atrHistory.spanMs / 3_600_000) * 10) / 10,
      ready: this.#atrHistory.ready,
    };
  }

  /**
   * Nap san lich su ATR tu du lieu da luu. Khong co ham nay thi moi lan worker khoi
   * dong lai (deploy, crash, Fly doi may) bo loc che do ve lai "CHUA_DU_DU_LIEU" va
   * he thong cam 6 gio — trong mot lan chay 72 gio thi do la rat nhieu thoi gian chet.
   */
  hydrateAtrHistory(samples: readonly { ts: number; atrPct: number }[]): number {
    let kept = 0;
    for (const s of samples) if (this.#atrHistory.push(s.ts, s.atrPct)) kept += 1;
    return kept;
  }

  #window(sec: number): BarLite[] {
    const last = this.#buf[this.#buf.length - 1];
    if (last === undefined) return [];
    const from = last.ts - sec * 1000;
    return this.#buf.filter((x) => x.ts > from);
  }

  #lastPrice(): number | null {
    for (let i = this.#buf.length - 1; i >= 0; i -= 1) {
      const c = this.#buf[i]?.close;
      if (c !== null && c !== undefined) return c;
    }
    return null;
  }

  /**
   * OFI tren dinh so lenh. Quy tac chuan: gia bid tang thi cong toan bo khoi luong moi,
   * bang nhau thi cong phan chenh, giam thi tru khoi luong cu. Doi xung cho ask.
   */
  #ofi(sec: number): number | null {
    const w = this.#window(sec);
    if (w.length < 2) return null;
    let ofi = 0;
    let valid = 0;
    for (let i = 1; i < w.length; i += 1) {
      const p = w[i - 1];
      const c = w[i];
      if (p === undefined || c === undefined) continue;
      if (p.bid === null || c.bid === null || p.ask === null || c.ask === null) continue;
      if (p.bidQty === null || c.bidQty === null || p.askQty === null || c.askQty === null) continue;

      if (c.bid > p.bid) ofi += c.bidQty;
      else if (c.bid === p.bid) ofi += c.bidQty - p.bidQty;
      else ofi -= p.bidQty;

      if (c.ask < p.ask) ofi -= c.askQty;
      else if (c.ask === p.ask) ofi -= c.askQty - p.askQty;
      else ofi += p.askQty;
      valid += 1;
    }
    return valid === 0 ? null : ofi;
  }

  #cvd(sec: number): number | null {
    const w = this.#window(sec);
    if (w.length === 0) return null;
    return w.reduce((a, x) => a + x.takerBuy - x.takerSell, 0);
  }

  #median(xs: number[]): number | null {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    if (s.length % 2 === 1) return s[mid] ?? null;
    const a = s[mid - 1];
    const b = s[mid];
    return a === undefined || b === undefined ? null : (a + b) / 2;
  }

  /** ATR khung 5 phut quy ve % gia. Bo loc che do thi truong. */
  #atr5mPct(): number | null {
    const w = this.#window(70 * MIN);
    if (w.length < 20 * MIN) return null;

    const buckets = new Map<number, { h: number; l: number; c: number }>();
    for (const b of w) {
      if (b.high === null || b.low === null || b.close === null) continue;
      const k = Math.floor(b.ts / (5 * 60_000));
      const cur = buckets.get(k);
      if (cur === undefined) buckets.set(k, { h: b.high, l: b.low, c: b.close });
      else {
        cur.h = Math.max(cur.h, b.high);
        cur.l = Math.min(cur.l, b.low);
        cur.c = b.close;
      }
    }

    const candles = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    if (candles.length < 3) return null;

    const trs: number[] = [];
    for (let i = 1; i < candles.length; i += 1) {
      const c = candles[i];
      const p = candles[i - 1];
      if (c === undefined || p === undefined) continue;
      trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
    }
    if (trs.length === 0) return null;

    const atr = trs.reduce((a, b) => a + b, 0) / trs.length;
    const px = this.#lastPrice();
    return px === null || px === 0 ? null : (atr / px) * 100;
  }

  #extreme(sec: number, kind: 'high' | 'low'): number | null {
    const w = this.#window(sec);
    const vals = w
      .map((x) => (kind === 'high' ? x.high : x.low))
      .filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    return kind === 'high' ? Math.max(...vals) : Math.min(...vals);
  }

  #vwap(sec: number): number | null {
    const w = this.#window(sec);
    let pv = 0;
    let v = 0;
    for (const b of w) {
      if (b.vwap === null || b.volume === 0) continue;
      pv += b.vwap * b.volume;
      v += b.volume;
    }
    return v === 0 ? null : pv / v;
  }

  snapshot(): FeatureSnapshot | null {
    const last = this.#buf[this.#buf.length - 1];
    if (last === undefined) return null;

    const atr5mPct = this.#atr5mPct();
    if (atr5mPct !== null) this.#atrHistory.push(last.ts, atr5mPct);

    // Chua du mau => null, va vi regimeOk yeu cau BIEN_DONG_CAO nen he thong tu dong
    // khong phat signal nao cho toi khi tich du lich su. Dung nhu y do.
    const atrPercentile = atr5mPct === null ? null : this.#atrHistory.percentileOf(atr5mPct);

    const spreads = this.#window(60 * MIN)
      .map((x) => x.spread)
      .filter((v): v is number => v !== null);
    const mid = last.bid !== null && last.ask !== null ? (last.bid + last.ask) / 2 : this.#lastPrice();
    const vwap5m = this.#vwap(5 * MIN);
    const atrAbs = atr5mPct !== null && mid !== null ? (atr5mPct / 100) * mid : null;

    const regimeLabel: FeatureSnapshot['regimeLabel'] =
      atrPercentile === null
        ? 'CHUA_DU_DU_LIEU'
        : atrPercentile >= REGIME.atrPercentileFloor
          ? 'BIEN_DONG_CAO'
          : 'BIEN_DONG_THAP';

    const liqWindow = this.#window(60 * SEC);

    return {
      barTs: new Date(last.ts),
      availableAt: new Date(),
      mid,
      ofi10s: this.#ofi(10 * SEC),
      cvd60s: this.#cvd(60 * SEC),
      spreadBps: last.spread,
      spreadMedian1h: this.#median(spreads),
      vwapDev:
        vwap5m !== null && mid !== null && atrAbs !== null && atrAbs > 0
          ? (mid - vwap5m) / atrAbs
          : null,
      bookImb: this.#bookImb,
      liqLong60s: liqWindow.reduce((a, x) => a + x.liqLong, 0),
      liqShort60s: liqWindow.reduce((a, x) => a + x.liqShort, 0),
      atr5mPct,
      atrPercentile,
      fundingPct: null,
      oiChg4h: null,
      minutesToFunding: null,
      range30mHigh: this.#extreme(30 * MIN, 'high'),
      range30mLow: this.#extreme(30 * MIN, 'low'),
      high15m: this.#extreme(15 * MIN, 'high'),
      low15m: this.#extreme(15 * MIN, 'low'),
      high4h: this.#extreme(4 * 3600, 'high'),
      vwap15m: this.#vwap(15 * MIN),
      regimeOk: regimeLabel === 'BIEN_DONG_CAO',
      regimeLabel,
    };
  }
}
