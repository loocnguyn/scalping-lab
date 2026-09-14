/**
 * So co thang (fixed-point) tren BigInt.
 * CLAUDE.md / Quy uoc code: "Gia va khoi luong dung kieu so nguyen theo tick/step hoac
 * decimal, KHONG dung float cho tinh toan tien."
 *
 * Binance gui so duoi dang string ("77324.10"). Ta parse THANG tu string sang BigInt,
 * khong bao gio di qua Number() — vi 0.1 + 0.2 !== 0.3 va sai so do se tich luy qua
 * hang trieu trade.
 */

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * "77324.1" voi scale 100n -> 7732410n
 * Cat bot chu so thua (khong lam tron) de ket qua luon xac dinh.
 */
export function parseFixed(raw: string, scale: bigint): bigint {
  const m = DECIMAL_RE.exec(raw.trim());
  if (m === null) throw new Error(`Khong parse duoc so thap phan: ${JSON.stringify(raw)}`);

  const sign = m[1] === '-' ? -1n : 1n;
  const intPart = m[2] ?? '0';
  const fracRaw = m[3] ?? '';

  const digits = scaleDigits(scale);
  const frac = fracRaw.length >= digits
    ? fracRaw.slice(0, digits)
    : fracRaw.padEnd(digits, '0');

  const combined = frac.length > 0 ? `${intPart}${frac}` : intPart;
  return sign * BigInt(combined);
}

/** 100n -> 2, 100000000n -> 8 */
function scaleDigits(scale: bigint): number {
  let n = scale;
  let d = 0;
  while (n > 1n) {
    n /= 10n;
    d += 1;
  }
  return d;
}

/** 7732410n voi scale 100n -> "77324.10". Dung de ghi xuong cot numeric cua Postgres. */
export function formatFixed(value: bigint, scale: bigint): string {
  const digits = scaleDigits(scale);
  if (digits === 0) return value.toString();

  const neg = value < 0n;
  const abs = neg ? -value : value;
  const s = abs.toString().padStart(digits + 1, '0');
  const int = s.slice(0, s.length - digits);
  const frac = s.slice(s.length - digits);
  return `${neg ? '-' : ''}${int}.${frac}`;
}

/**
 * Gia tri danh nghia = gia x khoi luong, tra ve theo thang PRICE_SCALE (tuc USDT).
 * Nhan hai BigInt roi chia bot mot thang — khong mat do chinh xac o buoc nhan.
 */
export function notional(priceI: bigint, qtyI: bigint, qtyScale: bigint): bigint {
  return (priceI * qtyI) / qtyScale;
}

/** Trung binh co trong so, lam tron ve 0. Dung cho VWAP. */
export function weightedMean(sumOfProducts: bigint, sumOfWeights: bigint): bigint | null {
  if (sumOfWeights === 0n) return null;
  return sumOfProducts / sumOfWeights;
}

/**
 * Spread tinh bang basis point, tra ve so nguyen theo thang 1e4 (tuc 1 don vi = 0.0001 bps).
 * (ask - bid) / mid * 10000
 */
export function spreadBps(bidI: bigint, askI: bigint): bigint | null {
  const mid = bidI + askI;
  if (mid <= 0n) return null;
  // nhan 2 vi mid that = (bid+ask)/2; gop lai de tranh chia som
  return ((askI - bidI) * 2n * 10_000n * 10_000n) / mid;
}
