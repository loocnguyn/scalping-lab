/**
 * Cua so cuon chieu de tinh percentile — dung cho bo loc che do (muc 4 ke hoach).
 *
 * Tach rieng khoi FeatureEngine vi ba ly do, moi ly do la mot loi da tung co:
 *
 * 1. CUA SO PHAI DUNG BANG SO NGAY KHAI BAO.
 *    Ban truoc luu 1 mau/giay roi cap o 200.000 phan tu. 7 ngay can 604.800 mau,
 *    nen cap chan truoc cutoff va cua so thuc te chi con 2,31 ngay. Bo loc che do
 *    dung truoc moi rule, nen sai no la sai toan bo viec signal nao duoc phat —
 *    va no chi lo ra sau 2,3 ngay chay lien tuc, dung luc bat dau tin he thong.
 *
 * 2. LAY MAU MOI GIAY LA VO NGHIA THONG KE.
 *    ATR(5m) gan nhu khong doi giua hai giay lien tiep. 604.800 mau gan trung nhau
 *    cho ra cung mot phan phoi voi 10.080 mau cach nhau 1 phut, nhung ton gap 60 lan
 *    bo nho. Te hon: khi moi chay, 600 mau dau = 10 phut ATR gan nhu y het nhau,
 *    percentile tinh ra tu do la con so ngau nhien doi lot khoa hoc.
 *
 * 3. KHONG CAP PHAT MANG MOI MOI GIAY.
 *    `filter()` tren 200.000 phan tu moi giay tao rac lien tuc. Day dung chi so
 *    dau va don dep theo lo.
 */

export interface RollingPercentileConfig {
  /** Do dai cua so, tinh bang ms. */
  readonly windowMs: number;
  /** Khoang cach toi thieu giua hai mau duoc giu. */
  readonly sampleIntervalMs: number;
  /** Duoi so mau nay thi tra ve null thay vi mot percentile khong dang tin. */
  readonly minSamples: number;
}

export class RollingPercentile {
  #ts: number[] = [];
  #val: number[] = [];
  /** Chi so cua mau cu nhat con hieu luc. Don dep that su chay theo lo. */
  #head = 0;
  #lastKeptTs = Number.NEGATIVE_INFINITY;

  constructor(private readonly cfg: RollingPercentileConfig) {}

  /** So mau dang con hieu luc trong cua so. */
  get size(): number {
    return this.#ts.length - this.#head;
  }

  /** Khoang thoi gian ma cac mau hien co dang phu, tinh bang ms. */
  get spanMs(): number {
    if (this.size === 0) return 0;
    const first = this.#ts[this.#head];
    const last = this.#ts[this.#ts.length - 1];
    if (first === undefined || last === undefined) return 0;
    return last - first;
  }

  get ready(): boolean {
    return this.size >= this.cfg.minSamples;
  }

  /**
   * Them mot quan sat. Mau den som hon `sampleIntervalMs` so voi mau truoc se bi bo —
   * co chu y, xem ly do 2 o dau file.
   * @returns true neu mau duoc giu lai
   */
  push(ts: number, value: number): boolean {
    if (!Number.isFinite(value)) return false;
    if (ts - this.#lastKeptTs < this.cfg.sampleIntervalMs) return false;

    this.#ts.push(ts);
    this.#val.push(value);
    this.#lastKeptTs = ts;
    this.#prune(ts);
    return true;
  }

  #prune(nowTs: number): void {
    const cutoff = nowTs - this.cfg.windowMs;
    while (this.#head < this.#ts.length) {
      const t = this.#ts[this.#head];
      if (t === undefined || t >= cutoff) break;
      this.#head += 1;
    }
    // Don that khi phan da bo chiem qua nua mang, de khong giu rac mai.
    if (this.#head > 1_000 && this.#head * 2 > this.#ts.length) {
      this.#ts = this.#ts.slice(this.#head);
      this.#val = this.#val.slice(this.#head);
      this.#head = 0;
    }
  }

  /**
   * Percentile cua `value` so voi cac mau trong cua so (0-100).
   * null khi chua du mau — thanh that hon la tra ve mot con so nghe co ve co nghia.
   */
  percentileOf(value: number): number | null {
    const n = this.size;
    if (n < this.cfg.minSamples) return null;
    let below = 0;
    for (let i = this.#head; i < this.#val.length; i += 1) {
      const v = this.#val[i];
      if (v !== undefined && v < value) below += 1;
    }
    return (below / n) * 100;
  }
}
