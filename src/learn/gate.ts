/**
 * Tang thich nghi Muc 1 (muc 6 ke hoach) — "thu dang lam nhat" theo chinh tai lieu,
 * va la phan tra loi cau hoi "co that su sinh ra loi nhuan khong".
 *
 * Voi moi cap (setup x che do x khung gio), tinh expectancy tren N lenh gan nhat.
 * Expectancy RONG am => tu dong tat setup do, van tiep tuc ghi nhan o che do shadow.
 * Khi thong ke hoi phuc thi tu bat lai.
 *
 * Vi sao dang bandit don gian nay gan nhu khong the overfit: no chi dung KET QUA THAT
 * DA XAY RA cua chinh setup do, khong uoc luong tham so nao, khong nhin vao feature.
 * Khong co gi de overfit ca.
 *
 * Diem quan trong: expectancy tinh tren `rNet` — sau phi. Tinh tren r_gross se cho ra
 * mot he thong "co lai" ma tai khoan van cu teo dan.
 */

import { log } from '../lib/logger.js';
import type { SetupId } from '../signal/engine.js';
import type { PaperPosition } from '../paper/broker.js';

export interface BucketStats {
  readonly key: string;
  readonly setup: SetupId;
  readonly regime: string;
  readonly hourBucket: number;
  readonly n: number;
  readonly wins: number;
  readonly winRate: number;
  readonly expRNet: number;
  readonly expRGross: number;
  readonly enabled: boolean;
  /** Ty le signal khong khop duoc lenh limit — cao nghia la gia vao dat sai cho. */
  readonly nofillRate: number;
}

export interface GateConfig {
  /** So lenh gan nhat dung de tinh expectancy. */
  readonly windowN: number;
  /** Duoi so mau nay thi chua ket luan gi — de setup chay tiep. */
  readonly minSamples: number;
  /** Expectancy rong duoi nguong nay => tat. */
  readonly disableBelow: number;
  /** Expectancy rong tren nguong nay => bat lai. */
  readonly enableAbove: number;
}

export const DEFAULT_GATE: GateConfig = {
  windowN: 50,
  // Duoi 20 mau, expectancy chi la nhieu. Tat setup luc do la phan ung voi ngau nhien.
  minSamples: 20,
  disableBelow: 0,
  enableAbove: 0.05,
};

interface Bucket {
  setup: SetupId;
  regime: string;
  hourBucket: number;
  /** Cac lenh DA KHOP, moi nhat o cuoi. */
  results: { rNet: number; rGross: number; win: boolean }[];
  nofills: number;
  fills: number;
  enabled: boolean;
}

function keyOf(setup: string, regime: string, hour: number): string {
  return setup + '|' + regime + '|' + String(hour);
}

export class AdaptiveGate {
  #buckets = new Map<string, Bucket>();

  constructor(private readonly cfg: GateConfig = DEFAULT_GATE) {}

  /** Signal engine hoi truoc khi phat. */
  isEnabled = (setup: SetupId, regime: string, hour: number): boolean => {
    const b = this.#buckets.get(keyOf(setup, regime, hour));
    return b === undefined ? true : b.enabled;
  };

  /** Nap lai trang thai tu DB khi worker khoi dong lai — tri nho phai song qua restart. */
  hydrate(rows: readonly { setup: string; regime: string; hour_bucket: number; enabled: boolean }[]): void {
    for (const r of rows) {
      const k = keyOf(r.setup, r.regime, r.hour_bucket);
      const b = this.#ensure(k, r.setup as SetupId, r.regime, r.hour_bucket);
      b.enabled = r.enabled;
    }
    log.info('gate.hydrated', { buckets: rows.length });
  }

  #ensure(k: string, setup: SetupId, regime: string, hour: number): Bucket {
    let b = this.#buckets.get(k);
    if (b === undefined) {
      b = { setup, regime, hourBucket: hour, results: [], nofills: 0, fills: 0, enabled: true };
      this.#buckets.set(k, b);
    }
    return b;
  }

  /** Goi khi mot lenh paper dong lai. Day la vong nguoc cua kien truc. */
  record(p: PaperPosition): void {
    const s = p.signal;
    const hour = s.ts.getUTCHours();
    const k = keyOf(s.setup, s.regime, hour);
    const b = this.#ensure(k, s.setup, s.regime, hour);

    if (p.outcome === 'nofill') {
      b.nofills += 1;
      return;
    }
    if (p.rNet === null || p.rGross === null) return;

    b.fills += 1;
    b.results.push({ rNet: p.rNet, rGross: p.rGross, win: p.rNet > 0 });
    if (b.results.length > this.cfg.windowN) {
      b.results.splice(0, b.results.length - this.cfg.windowN);
    }

    this.#reevaluate(b);
  }

  #reevaluate(b: Bucket): void {
    if (b.results.length < this.cfg.minSamples) return;

    const expRNet = b.results.reduce((a, x) => a + x.rNet, 0) / b.results.length;
    const was = b.enabled;

    if (b.enabled && expRNet < this.cfg.disableBelow) {
      b.enabled = false;
    } else if (!b.enabled && expRNet > this.cfg.enableAbove) {
      b.enabled = true;
    }

    if (was !== b.enabled) {
      log.warn(b.enabled ? 'gate.setup_reenabled' : 'gate.setup_disabled', {
        setup: b.setup,
        regime: b.regime,
        hourUtc: b.hourBucket,
        n: b.results.length,
        expRNet: Math.round(expRNet * 1000) / 1000,
        note: b.enabled
          ? 'expectancy rong hoi phuc — bat lai'
          : 'expectancy rong am — tat, van ghi nhan o shadow',
      });
    }
  }

  stats(): readonly BucketStats[] {
    const out: BucketStats[] = [];
    for (const [k, b] of this.#buckets) {
      const n = b.results.length;
      if (n === 0 && b.nofills === 0) continue;
      const wins = b.results.filter((x) => x.win).length;
      out.push({
        key: k,
        setup: b.setup,
        regime: b.regime,
        hourBucket: b.hourBucket,
        n,
        wins,
        winRate: n === 0 ? 0 : wins / n,
        expRNet: n === 0 ? 0 : b.results.reduce((a, x) => a + x.rNet, 0) / n,
        expRGross: n === 0 ? 0 : b.results.reduce((a, x) => a + x.rGross, 0) / n,
        enabled: b.enabled,
        nofillRate: b.fills + b.nofills === 0 ? 0 : b.nofills / (b.fills + b.nofills),
      });
    }
    return out.sort((a, b) => b.n - a.n);
  }

  /**
   * Tong ket toan cuc — cau tra loi truc tiep cho "co that su sinh ra loi nhuan khong".
   * Tra ve null khi chua du mau, thay vi mot con so nghe co ve co y nghia.
   */
  overall(): {
    n: number;
    winRate: number;
    expRNet: number;
    expRGross: number;
    totalRNet: number;
    verdict: string;
  } | null {
    const all = [...this.#buckets.values()].flatMap((b) => b.results);
    if (all.length === 0) return null;

    const n = all.length;
    const wins = all.filter((x) => x.win).length;
    const expRNet = all.reduce((a, x) => a + x.rNet, 0) / n;
    const expRGross = all.reduce((a, x) => a + x.rGross, 0) / n;
    const totalRNet = all.reduce((a, x) => a + x.rNet, 0);

    // Cua 2 doi expectancy rong > +0.15R tren >= 200 mau.
    const verdict =
      n < 200
        ? 'chua du mau (' + n + '/200) — chua ket luan duoc gi'
        : expRNet > 0.15
          ? 'dat nguong Cua 2 tren tap nay — can kiem tra walk-forward truoc khi tin'
          : expRNet > 0
            ? 'duong nhung duoi +0.15R — chua du bien an toan'
            : 'expectancy rong am — chien luoc nay dang lo tien sau phi';

    return { n, winRate: wins / n, expRNet, expRGross, totalRNet, verdict };
  }
}
