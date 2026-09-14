/**
 * Lay funding va Open Interest qua REST.
 *
 * KY LUAT CHONG LOOKAHEAD (rang buoc cung #5) — day la cho de sai nhat trong ca du an.
 * `openInterestHist` co tan suat 5 phut VA co do tre. Moc `timestamp` tra ve la thoi
 * diem NEN DO thuoc ve, khong phai thoi diem ta biet duoc no. Gan gia tri OI cua 10:05
 * vao quyet dinh tai 10:01 se lam backtest dep mot cach gia tao.
 *
 * Nen: moi gia tri luu kem `available_at = luc response ve tay ta`. Signal engine chi
 * duoc doc gia tri co available_at <= thoi diem dang xet.
 */

import { log, errFields } from '../lib/logger.js';

const FAPI = 'https://fapi.binance.com';

export interface FundingSnapshot {
  readonly lastFundingRate: number;
  readonly markPrice: number;
  readonly nextFundingTime: number;
  readonly availableAt: Date;
}

export interface OiSnapshot {
  readonly openInterest: number;
  /** Moc du lieu thuoc ve (tu Binance). */
  readonly dataTs: Date;
  /** Moc ta thuc su biet — dung cot nay de loc. */
  readonly availableAt: Date;
}

async function getJson(path: string, timeoutMs = 10_000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(FAPI + path, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + path);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function num(v: unknown, field: string): number {
  if (typeof v === 'string' || typeof v === 'number') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw new Error('Truong ' + field + ' khong phai so: ' + JSON.stringify(v));
}

export class RestPoller {
  #funding: FundingSnapshot | null = null;
  #oi: OiSnapshot | null = null;
  /** Lich su funding 30 ngay de tinh percentile (feature funding_pct). */
  #fundingHistory: number[] = [];
  /** Chuoi OI theo moc 5 phut, de tinh oi_chg_4h. */
  #oiHistory: { ts: number; value: number }[] = [];
  #timers: NodeJS.Timeout[] = [];

  get funding(): FundingSnapshot | null { return this.#funding; }
  get oi(): OiSnapshot | null { return this.#oi; }

  async start(): Promise<void> {
    await this.#loadHistory();
    await this.#pollFunding();
    await this.#pollOi();
    // Funding doi cham; OI cap nhat 5 phut mot lan o phia Binance.
    this.#timers.push(setInterval(() => { void this.#pollFunding(); }, 30_000));
    this.#timers.push(setInterval(() => { void this.#pollOi(); }, 60_000));
    this.#timers.push(setInterval(() => { void this.#loadHistory(); }, 6 * 60 * 60 * 1000));
  }

  stop(): void {
    for (const t of this.#timers) clearInterval(t);
    this.#timers = [];
  }

  async #pollFunding(): Promise<void> {
    try {
      const d = await getJson('/fapi/v1/premiumIndex?symbol=BTCUSDT');
      if (typeof d !== 'object' || d === null) return;
      const o = d as Record<string, unknown>;
      this.#funding = {
        lastFundingRate: num(o['lastFundingRate'], 'lastFundingRate'),
        markPrice: num(o['markPrice'], 'markPrice'),
        nextFundingTime: num(o['nextFundingTime'], 'nextFundingTime'),
        availableAt: new Date(),
      };
    } catch (e) {
      log.warn('rest.funding_failed', errFields(e));
    }
  }

  async #pollOi(): Promise<void> {
    try {
      const d = await getJson('/fapi/v1/openInterest?symbol=BTCUSDT');
      if (typeof d !== 'object' || d === null) return;
      const o = d as Record<string, unknown>;
      const value = num(o['openInterest'], 'openInterest');
      const dataTs = new Date(num(o['time'], 'time'));
      this.#oi = { openInterest: value, dataTs, availableAt: new Date() };
      this.#oiHistory.push({ ts: dataTs.getTime(), value });
      // Giu 5 gio de du tinh oi_chg_4h.
      const cutoff = Date.now() - 5 * 3600_000;
      this.#oiHistory = this.#oiHistory.filter((x) => x.ts >= cutoff);
    } catch (e) {
      log.warn('rest.oi_failed', errFields(e));
    }
  }

  /** Nap lich su funding (30 ngay) va OI (nhieu gio) de feature co gia tri ngay tu dau. */
  async #loadHistory(): Promise<void> {
    try {
      const fr = await getJson('/fapi/v1/fundingRate?symbol=BTCUSDT&limit=90');
      if (Array.isArray(fr)) {
        this.#fundingHistory = fr
          .map((x) => (typeof x === 'object' && x !== null ? Number((x as Record<string, unknown>)['fundingRate']) : NaN))
          .filter((n) => Number.isFinite(n));
      }
      const oih = await getJson('/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=60');
      if (Array.isArray(oih)) {
        const rows = oih
          .map((x) => {
            const o = x as Record<string, unknown>;
            return { ts: Number(o['timestamp']), value: Number(o['sumOpenInterest']) };
          })
          .filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.value));
        this.#oiHistory = rows.concat(this.#oiHistory).sort((a, b) => a.ts - b.ts);
      }
      log.info('rest.history_loaded', {
        fundingSamples: this.#fundingHistory.length,
        oiSamples: this.#oiHistory.length,
      });
    } catch (e) {
      log.warn('rest.history_failed', errFields(e));
    }
  }

  /** Percentile cua funding hien tai so voi lich su. Feature `funding_pct`, kich hoat S2. */
  fundingPercentile(): number | null {
    const f = this.#funding;
    if (f === null || this.#fundingHistory.length < 10) return null;
    const below = this.#fundingHistory.filter((x) => x < f.lastFundingRate).length;
    return (below / this.#fundingHistory.length) * 100;
  }

  /** % thay doi OI trong 4 gio. Feature `oi_chg_4h`, kich hoat S2. */
  oiChange4h(): number | null {
    if (this.#oiHistory.length < 2) return null;
    const now = Date.now();
    const target = now - 4 * 3600_000;
    let oldest = this.#oiHistory[0];
    for (const r of this.#oiHistory) {
      if (r.ts <= target) oldest = r;
      else break;
    }
    const latest = this.#oiHistory[this.#oiHistory.length - 1];
    if (oldest === undefined || latest === undefined || oldest.value === 0) return null;
    // Neu chua du 4h lich su thi khong bia ra con so.
    if (latest.ts - oldest.ts < 2 * 3600_000) return null;
    return ((latest.value - oldest.value) / oldest.value) * 100;
  }

  /** Con bao lau toi gio funding (phut). S2 khong vao khi con duoi 30 phut. */
  minutesToFunding(): number | null {
    const f = this.#funding;
    if (f === null) return null;
    return (f.nextFundingTime - Date.now()) / 60_000;
  }
}
