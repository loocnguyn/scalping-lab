/**
 * Paper broker — tu dong "vao lenh" tren moi signal va theo doi toi khi cham TP hoac SL.
 *
 * DAY LA MO PHONG. Khong co dong nao gui lenh len Binance. Rang buoc cung #7: khong
 * viet code tu dong dat lenh cho toi khi qua ca 4 cua o muc 8. Doi lai, MOI thu khac
 * deu that: gia that, thoi diem that, phi that, va ket qua khong duoc phep dep hon
 * thuc te.
 *
 * BON QUYET DINH BI QUAN CO CHU Y — moi cai deu lam ket qua XAU di so voi mo phong
 * ngay tho. Do la chu dich. Mo hinh khop lac quan chinh la cach backtest noi doi.
 *
 *   1. Lenh limit chi coi la khop khi gia di XUYEN QUA muc gia do, khong phai cham la
 *      khop. Cham gia nghia la ban dang xep hang cuoi so lenh, phan lon khong duoc khop.
 *   2. Neu trong cung mot giay ca TP va SL deu bi cham, tinh la SL. Ta khong biet cai
 *      nao den truoc trong giay do, nen chon kha nang xau.
 *   3. Vao lenh va chot lai tinh phi MAKER (limit), nhung cat lo tinh phi TAKER —
 *      vi stop that su la lenh stop-market.
 *   4. Truot gia mot tick khi cat lo, vi stop-market khong khop dung gia.
 *
 * Moi tinh toan tien chay tren so nguyen (cents). Rang buoc: khong float cho tien.
 */

import { FEES, PRICE_SCALE } from '../config/index.js';
import type { Signal } from '../signal/engine.js';

/** Phi tinh bang diem co ban (1 bp = 0.01%). maker 0.02% = 2bp, taker 0.05% = 5bp. */
const MAKER_BP = BigInt(Math.round(FEES.makerRate * 10_000));
const TAKER_BP = BigInt(Math.round(FEES.takerRate * 10_000));
/** tickSize BTCUSDT = 0.10 USDT = 10 cents. */
const TICK_CENTS = 10n;

export type OutcomeKind = 'tp' | 'sl' | 'timeout' | 'nofill';

export interface PaperPosition {
  readonly signal: Signal;
  readonly entryCents: bigint;
  readonly stopCents: bigint;
  readonly targetCents: bigint;
  status: 'pending' | 'open' | 'closed';
  filledAt: Date | null;
  closedAt: Date | null;
  exitCents: bigint | null;
  outcome: OutcomeKind | null;
  /** Lai tam thoi lon nhat da dat duoc (diem). */
  mfePoints: number;
  /** Lo tam thoi sau nhat da chiu (diem). */
  maePoints: number;
  rGross: number | null;
  rNet: number | null;
  pnlNetUsdtPerBtc: number | null;
  feesUsdtPerBtc: number | null;
}

function toCents(x: number): bigint {
  return BigInt(Math.round(x * Number(PRICE_SCALE)));
}
function centsToUsdt(c: bigint): number {
  return Number(c) / Number(PRICE_SCALE);
}
/** Phi mot chieu cho 1 BTC danh nghia, tra ve cents. */
function feeCents(priceCents: bigint, bp: bigint): bigint {
  return (priceCents * bp) / 10_000n;
}

export interface BrokerConfig {
  /** Giu lenh toi da bao lau roi dong theo gia thi truong. */
  readonly maxHoldSec: number;
  /** Rui ro moi lenh tinh theo % tai khoan — chi de goi y khoi luong. */
  readonly riskPctPerTrade: number;
  readonly accountUsdt: number;
}

export const DEFAULT_BROKER: BrokerConfig = {
  // Scalping: S1/S3 vai phut, S2 vai chuc phut. 2 gio la qua du — qua do thi
  // gia thuyet "qua da roi bat lai" da sai roi, giu them chi la hy vong.
  maxHoldSec: 2 * 3600,
  riskPctPerTrade: 0.5,
  accountUsdt: 1_000,
};

export class PaperBroker {
  #positions: PaperPosition[] = [];
  #closed: PaperPosition[] = [];

  constructor(
    private readonly cfg: BrokerConfig = DEFAULT_BROKER,
    private readonly onClose: (p: PaperPosition) => void = () => {},
  ) {}

  get openPositions(): readonly PaperPosition[] {
    return this.#positions.filter((p) => p.status !== 'closed');
  }
  get closedPositions(): readonly PaperPosition[] {
    return this.#closed;
  }

  /** Nhan signal -> tao lenh limit o trang thai pending (rang buoc cung #3). */
  submit(signal: Signal): PaperPosition {
    const p: PaperPosition = {
      signal,
      entryCents: toCents(signal.entryPx),
      stopCents: toCents(signal.stopPx),
      targetCents: toCents(signal.targetPx),
      status: 'pending',
      filledAt: null,
      closedAt: null,
      exitCents: null,
      outcome: null,
      mfePoints: 0,
      maePoints: 0,
      rGross: null,
      rNet: null,
      pnlNetUsdtPerBtc: null,
      feesUsdtPerBtc: null,
    };
    this.#positions.push(p);
    return p;
  }

  /**
   * Nhip gia moi giay. Truyen high/low/close cua bar 1 giay vua chot.
   * Day la noi moi lenh duoc khop, cham TP, cham SL, hoac het han.
   */
  onBar(high: number | null, low: number | null, close: number | null, at: Date): void {
    if (high === null || low === null || close === null) return;
    const h = toCents(high);
    const l = toCents(low);
    const c = toCents(close);

    for (const p of this.#positions) {
      if (p.status === 'closed') continue;
      const isLong = p.signal.side === 'LONG';

      if (p.status === 'pending') {
        if (at.getTime() > p.signal.expiresAt.getTime()) {
          this.#close(p, null, 'nofill', at);
          continue;
        }
        // Bi quan #1: phai di XUYEN QUA gia limit moi coi la khop.
        const filled = isLong ? l < p.entryCents : h > p.entryCents;
        if (filled) {
          p.status = 'open';
          p.filledAt = at;
        } else {
          continue;
        }
      }

      // Cap nhat MFE/MAE truoc khi xet dong lenh.
      const favourable = isLong ? h - p.entryCents : p.entryCents - l;
      const adverse = isLong ? p.entryCents - l : h - p.entryCents;
      p.mfePoints = Math.max(p.mfePoints, centsToUsdt(favourable));
      p.maePoints = Math.max(p.maePoints, centsToUsdt(adverse));

      const hitStop = isLong ? l <= p.stopCents : h >= p.stopCents;
      const hitTarget = isLong ? h >= p.targetCents : l <= p.targetCents;

      // Bi quan #2: cham ca hai trong cung mot giay => tinh la SL.
      if (hitStop) {
        // Bi quan #4: stop-market truot mot tick.
        const slip = isLong ? -TICK_CENTS : TICK_CENTS;
        this.#close(p, p.stopCents + slip, 'sl', at);
      } else if (hitTarget) {
        this.#close(p, p.targetCents, 'tp', at);
      } else if (
        p.filledAt !== null &&
        at.getTime() - p.filledAt.getTime() > this.cfg.maxHoldSec * 1000
      ) {
        this.#close(p, c, 'timeout', at);
      }
    }

    this.#positions = this.#positions.filter((p) => p.status !== 'closed');
  }

  #close(p: PaperPosition, exitCents: bigint | null, outcome: OutcomeKind, at: Date): void {
    p.status = 'closed';
    p.closedAt = at;
    p.outcome = outcome;
    p.exitCents = exitCents;

    if (outcome === 'nofill' || exitCents === null) {
      // Khong khop = khong co lenh = khong lai khong lo, va cung KHONG duoc tinh
      // vao thong ke thang/thua. Nhung van phai ghi lai: ty le nofill cao nghia la
      // gia vao lenh limit dat sai cho, do la thong tin quan trong.
      p.rGross = null;
      p.rNet = null;
      p.pnlNetUsdtPerBtc = null;
      p.feesUsdtPerBtc = null;
      this.#closed.push(p);
      this.onClose(p);
      return;
    }

    const isLong = p.signal.side === 'LONG';
    const grossCents = isLong ? exitCents - p.entryCents : p.entryCents - exitCents;

    // Bi quan #3: vao bang limit (maker). Ra bang limit neu chot lai, bang market neu cat lo.
    const entryFee = feeCents(p.entryCents, MAKER_BP);
    const exitFee = feeCents(exitCents, outcome === 'sl' || outcome === 'timeout' ? TAKER_BP : MAKER_BP);
    const fees = entryFee + exitFee;

    const netCents = grossCents - fees;
    const stopDistCents = isLong ? p.entryCents - p.stopCents : p.stopCents - p.entryCents;

    p.rGross = stopDistCents === 0n ? null : Number(grossCents) / Number(stopDistCents);
    // r_net la cot quan trong nhat trong toan bo he thong. Moi ket luan "co lai hay
    // khong" deu doc tu day, khong bao gio tu r_gross.
    p.rNet = stopDistCents === 0n ? null : Number(netCents) / Number(stopDistCents);
    p.pnlNetUsdtPerBtc = centsToUsdt(netCents);
    p.feesUsdtPerBtc = centsToUsdt(fees);

    this.#closed.push(p);
    this.onClose(p);
  }

  /**
   * Khoi luong goi y, tinh TU KHOANG CACH STOP — khong bao gio chon don bay truoc
   * roi suy nguoc (canh bao o muc 8).
   */
  suggestedQtyBtc(signal: Signal): number {
    const riskUsdt = (this.cfg.accountUsdt * this.cfg.riskPctPerTrade) / 100;
    if (signal.stopPoints <= 0) return 0;
    const raw = riskUsdt / signal.stopPoints;
    // stepSize 0.001
    return Math.floor(raw * 1000) / 1000;
  }

  /** Don bay danh nghia ma khoi luong tren doi hoi — con so nguoi ta hay quen kiem tra. */
  notionalLeverage(signal: Signal): number {
    const qty = this.suggestedQtyBtc(signal);
    return (qty * signal.entryPx) / this.cfg.accountUsdt;
  }
}
