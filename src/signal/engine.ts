/**
 * Signal engine — ba setup o muc 5 ke hoach.
 *
 * Rang buoc cung duoc cuong che NGAY TAI DAY, khong phai bang y thuc nguoi viet:
 *   #2  moi signal phai co target >= TARGET.minTargetPoints (250 diem)
 *   #3  vao lenh mac dinh la limit, co han huy neu khong khop
 *   #4  moi signal bat buoc co entry, stop, target, han hieu luc
 *   #7  shadow mode — engine chi PHAT signal, khong bao gio dat lenh that
 *
 * Bo loc che do (muc 4) chay TRUOC moi rule. Neu chua du du lieu de biet che do,
 * he thong khong phat gi ca — im lang la dung, doan bua moi la sai.
 */

import { randomUUID } from 'node:crypto';
import { REGIME, TARGET } from '../config/index.js';
import type { FeatureSnapshot } from '../features/engine.js';

export type SetupId = 'S1' | 'S2' | 'S3';
export type Side = 'LONG' | 'SHORT';

export interface Signal {
  readonly id: string;
  readonly ts: Date;
  readonly setup: SetupId;
  readonly side: Side;
  readonly entryPx: number;
  readonly stopPx: number;
  readonly targetPx: number;
  /** Han khop lenh limit. Qua han ma khong khop => huy, ghi ket qua 'nofill'. */
  readonly expiresAt: Date;
  readonly regime: FeatureSnapshot['regimeLabel'];
  /** Bi cong loc chan? Van theo doi ket qua o che do shadow (muc 6, Muc 0). */
  readonly gated: boolean;
  readonly gateReason: string | null;
  readonly features: FeatureSnapshot;
  /** Khoang cach stop tinh bang diem — dung de tinh khoi luong tu rui ro. */
  readonly stopPoints: number;
  readonly targetPoints: number;
  readonly rMultiple: number;
}

/** Ly do mot setup khong kich hoat — giu lai de go loi va de hieu thi truong. */
export interface SetupEvaluation {
  readonly setup: SetupId;
  readonly fired: boolean;
  readonly reason: string;
}

export interface SignalEngineDeps {
  /** Tra ve false neu setup dang bi tang thich nghi tat (muc 6, Muc 1). */
  isSetupEnabled(setup: SetupId, regime: string, hour: number): boolean;
}

export class SignalEngine {
  /** Chong phat trung: mot setup khong duoc phat lai trong khoang nay. */
  #lastFired = new Map<SetupId, number>();
  #cooldownMs = 60_000;
  /** Dem cum thanh ly cung chieu de ap dung dieu kien loai tru cua S1. */
  #recentLiqClusters: { ts: number; side: Side }[] = [];
  readonly evaluations: SetupEvaluation[] = [];

  constructor(private readonly deps: SignalEngineDeps) {}

  /**
   * Danh gia toan bo setup tren mot snapshot feature.
   * Tra ve danh sach signal (thuong la rong — do la binh thuong va dung).
   */
  evaluate(f: FeatureSnapshot): Signal[] {
    this.evaluations.length = 0;

    // --- Bo loc che do: dung TRUOC moi rule (muc 4) ---
    if (!f.regimeOk) {
      this.#note('S1', false, 'che do ' + f.regimeLabel);
      this.#note('S2', false, 'che do ' + f.regimeLabel);
      this.#note('S3', false, 'che do ' + f.regimeLabel);
      return [];
    }

    // --- Bo loc spread: sổ lệnh mỏng thì đứng ngoài (muc 4) ---
    if (
      f.spreadBps !== null &&
      f.spreadMedian1h !== null &&
      f.spreadBps > REGIME.spreadMedianMultiplier * f.spreadMedian1h
    ) {
      const r = 'spread rong (' + f.spreadBps.toFixed(4) + ' bps > 2x trung vi)';
      this.#note('S1', false, r);
      this.#note('S2', false, r);
      this.#note('S3', false, r);
      return [];
    }

    const out: Signal[] = [];
    for (const c of [this.#s1(f), this.#s2(f), this.#s3(f)]) {
      if (c !== null) out.push(c);
    }
    return out;
  }

  #note(setup: SetupId, fired: boolean, reason: string): void {
    this.evaluations.push({ setup, fired, reason });
  }

  #cooledDown(setup: SetupId): boolean {
    const last = this.#lastFired.get(setup);
    return last === undefined || Date.now() - last > this.#cooldownMs;
  }

  /**
   * S1 — Bat nguoc sau cum thanh ly (thuong LONG).
   *
   * CANH BAO VAN HANH: setup nay phu thuoc hoan toan vao stream @forceOrder.
   * Neu stream do im lang (da xay ra that tren endpoint futures), liq_long_60s luon
   * bang 0 va S1 KHONG BAO GIO kich hoat. No se khong bao loi — chi im lang mai mai.
   * StreamHealth la thu duy nhat cho biet dieu do.
   */
  #s1(f: FeatureSnapshot): Signal | null {
    if (!this.#cooledDown('S1')) { this.#note('S1', false, 'dang cooldown'); return null; }
    if (f.mid === null || f.atr5mPct === null || f.low15m === null) {
      this.#note('S1', false, 'thieu feature'); return null;
    }

    const atrAbs = (f.atr5mPct / 100) * f.mid;
    if (atrAbs <= 0) { this.#note('S1', false, 'ATR = 0'); return null; }

    // Kich hoat: cum thanh ly LONG (ep ban) + gia tao day moi 15 phut + CVD dao duong
    const liqCluster = f.liqLong60s > 0;
    if (!liqCluster) { this.#note('S1', false, 'khong co cum thanh ly'); return null; }

    const madeNewLow = f.mid <= f.low15m * 1.0005;
    if (!madeNewLow) { this.#note('S1', false, 'chua tao day moi 15p'); return null; }

    if (f.cvd60s === null || f.cvd60s <= 0) {
      this.#note('S1', false, 'CVD chua dao duong'); return null;
    }

    // Dieu kien loai tru: da co 2 cum thanh ly cung chieu trong 10 phut
    // => xu huong that, khong phai qua da.
    const tenMinAgo = Date.now() - 10 * 60_000;
    this.#recentLiqClusters = this.#recentLiqClusters.filter((x) => x.ts > tenMinAgo);
    if (this.#recentLiqClusters.filter((x) => x.side === 'LONG').length >= 2) {
      this.#note('S1', false, 'da 2 cum cung chieu trong 10p — xu huong that');
      return null;
    }
    this.#recentLiqClusters.push({ ts: Date.now(), side: 'LONG' });

    const flushLow = f.low15m;
    const entry = flushLow + 0.05 * atrAbs;
    const stop = flushLow - 0.4 * atrAbs;
    // Muc tieu 2.5R hoac VWAP 15 phut, cai nao toi truoc.
    const r = entry - stop;
    const target2_5R = entry + 2.5 * r;
    const target = f.vwap15m !== null && f.vwap15m > entry
      ? Math.min(target2_5R, f.vwap15m)
      : target2_5R;

    return this.#build('S1', 'LONG', entry, stop, target, f, TARGET.pendingTimeoutSec.S1);
  }

  /** S2 — Siet vi the khi funding va OI cung cuc doan (thuong SHORT). */
  #s2(f: FeatureSnapshot): Signal | null {
    if (!this.#cooledDown('S2')) { this.#note('S2', false, 'dang cooldown'); return null; }
    if (f.mid === null || f.atr5mPct === null || f.high4h === null) {
      this.#note('S2', false, 'thieu feature'); return null;
    }
    if (f.fundingPct === null || f.oiChg4h === null) {
      this.#note('S2', false, 'chua du lich su funding/OI'); return null;
    }
    if (f.fundingPct <= 90) {
      this.#note('S2', false, 'funding percentile ' + f.fundingPct.toFixed(0) + ' <= 90'); return null;
    }
    if (f.oiChg4h <= 2) {
      this.#note('S2', false, 'OI 4h ' + f.oiChg4h.toFixed(2) + '% <= +2%'); return null;
    }
    if (f.ofi10s === null || f.ofi10s >= 0) {
      this.#note('S2', false, 'OFI chua chuyen am'); return null;
    }
    // Khong vao khi con duoi 30 phut toi gio funding.
    if (f.minutesToFunding !== null && f.minutesToFunding < 30) {
      this.#note('S2', false, 'con ' + f.minutesToFunding.toFixed(0) + ' phut toi gio funding'); return null;
    }

    const atrAbs = (f.atr5mPct / 100) * f.mid;
    const entry = f.mid;
    const stop = f.high4h + 0.2 * atrAbs;
    if (stop <= entry) { this.#note('S2', false, 'stop khong hop le'); return null; }
    const r = stop - entry;
    const target = entry - 2 * r;

    return this.#build('S2', 'SHORT', entry, stop, target, f, TARGET.pendingTimeoutSec.S2);
  }

  /** S3 — Phan ky dong lenh tai bien bien do. Phat nhieu tin hieu nhat. */
  #s3(f: FeatureSnapshot): Signal | null {
    if (!this.#cooledDown('S3')) { this.#note('S3', false, 'dang cooldown'); return null; }
    if (f.mid === null || f.atr5mPct === null) { this.#note('S3', false, 'thieu feature'); return null; }
    if (f.range30mHigh === null || f.range30mLow === null) {
      this.#note('S3', false, 'chua du bien do 30p'); return null;
    }

    const range = f.range30mHigh - f.range30mLow;
    // Khong vao khi bien do 30 phut nho hon 400 diem — khong du cho cho muc tieu.
    if (range < 400) {
      this.#note('S3', false, 'bien do 30p ' + range.toFixed(0) + ' diem < 400'); return null;
    }
    if (f.ofi10s === null || f.bookImb === null) {
      this.#note('S3', false, 'thieu OFI hoac book_imb'); return null;
    }

    const atrAbs = (f.atr5mPct / 100) * f.mid;
    const posInRange = (f.mid - f.range30mLow) / range;
    const mid = f.range30mLow + range / 2;

    // LONG: gia o 10% duoi bien do, OFI duong, book nghieng bid
    if (posInRange <= 0.1 && f.ofi10s > 0 && f.bookImb > 1.5) {
      const entry = f.mid;
      const stop = f.range30mLow - 0.5 * atrAbs;
      const r = entry - stop;
      const target = Math.max(entry + 2 * r, mid);
      return this.#build('S3', 'LONG', entry, stop, target, f, TARGET.pendingTimeoutSec.S3);
    }

    // SHORT: doi xung
    if (posInRange >= 0.9 && f.ofi10s < 0 && f.bookImb < 1 / 1.5) {
      const entry = f.mid;
      const stop = f.range30mHigh + 0.5 * atrAbs;
      const r = stop - entry;
      const target = Math.min(entry - 2 * r, mid);
      return this.#build('S3', 'SHORT', entry, stop, target, f, TARGET.pendingTimeoutSec.S3);
    }

    this.#note('S3', false, 'gia o ' + (posInRange * 100).toFixed(0) + '% bien do, chua cham bien');
    return null;
  }

  /**
   * Dung signal va cuong che rang buoc cung. Day la cho DUY NHAT sinh ra Signal —
   * de khong setup nao lach duoc luat.
   */
  #build(
    setup: SetupId,
    side: Side,
    entry: number,
    stop: number,
    target: number,
    f: FeatureSnapshot,
    timeoutSec: number,
  ): Signal | null {
    const stopPoints = Math.abs(entry - stop);
    const targetPoints = Math.abs(target - entry);

    // Rang buoc cung #2: khong bao gio de xuat TP duoi 250 diem.
    // TP 100 diem can win rate 88.7% de hoa von — de xuat nhu vay la sai, khong phai
    // "tin hieu yeu". Chan thang tai day.
    if (targetPoints < TARGET.minTargetPoints) {
      this.#note(setup, false,
        'target ' + targetPoints.toFixed(0) + ' diem < toi thieu ' + TARGET.minTargetPoints);
      return null;
    }
    if (stopPoints <= 0) { this.#note(setup, false, 'stop khong hop le'); return null; }

    // Huong phai nhat quan voi entry/stop/target.
    const ok = side === 'LONG' ? stop < entry && target > entry : stop > entry && target < entry;
    if (!ok) { this.#note(setup, false, 'entry/stop/target khong nhat quan voi huong'); return null; }

    const hour = new Date().getUTCHours();
    const enabled = this.deps.isSetupEnabled(setup, f.regimeLabel, hour);

    this.#lastFired.set(setup, Date.now());
    this.#note(setup, true, 'kich hoat');

    return {
      id: randomUUID(),
      ts: new Date(),
      setup,
      side,
      entryPx: entry,
      stopPx: stop,
      targetPx: target,
      expiresAt: new Date(Date.now() + timeoutSec * 1000),
      regime: f.regimeLabel,
      // Signal bi chan VAN duoc theo doi toi khi cham TP hoac SL (muc 6, Muc 0).
      // Khong co du lieu ve signal bi chan thi khong bao gio biet cong loc dung hay sai.
      gated: !enabled,
      gateReason: enabled ? null : 'setup bi tat boi tang thich nghi (expectancy am)',
      features: f,
      stopPoints,
      targetPoints,
      rMultiple: targetPoints / stopPoints,
    };
  }
}
