/**
 * Type that cho payload Binance USD-M Futures.
 * CLAUDE.md / Quy uoc code: "Khong dung `any` cho payload tu Binance — khai bao type that."
 *
 * Moi truong so deu la STRING trong JSON cua Binance. Giu nguyen string toi khi parse
 * sang so nguyen co thang (xem src/lib/fixed.ts) — khong bao gio Number() truc tiep.
 */

/** Khung bao combined-stream: wss://.../stream?streams=a/b/c */
export interface CombinedStreamEnvelope {
  readonly stream: string;
  readonly data: unknown;
}

/** btcusdt@aggTrade — giao dich khop lenh da gop. */
export interface AggTradeEvent {
  readonly e: 'aggTrade';
  /** Event time (ms) — thoi diem Binance phat. */
  readonly E: number;
  readonly s: string;
  /** Aggregate trade id. */
  readonly a: number;
  /** Gia. */
  readonly p: string;
  /** Khoi luong. */
  readonly q: string;
  readonly f: number;
  readonly l: number;
  /** Trade time (ms) — thoi diem khop that su. */
  readonly T: number;
  /**
   * true = ben mua la maker => nguoi BAN la taker (ban chu dong).
   * false = nguoi MUA la taker (mua chu dong).
   */
  readonly m: boolean;
}

/**
 * btcusdt@trade — tung lenh khop le.
 *
 * Dung stream nay THAY CHO @aggTrade: endpoint futures hien khong phat @aggTrade
 * (xem README muc "Trang thai stream"). @trade chi tiet hon @aggTrade — aggTrade chi
 * la ban gop cac fill cung gia/cung chieu — nen gop thanh bar 1 giay cho KET QUA Y HET.
 * Doi lai la nhieu message hon, khong dang ke o muc ~40 msg/giay.
 */
export interface TradeEvent {
  readonly e: 'trade';
  readonly E: number;
  readonly T: number;
  readonly s: string;
  /** Trade id. */
  readonly t: number;
  readonly p: string;
  readonly q: string;
  /** Loai lenh khop, vi du "MARKET". */
  readonly X?: string;
  /** true = ben mua la maker => nguoi BAN la taker. */
  readonly m: boolean;
}

/** btcusdt@forceOrder — thanh ly. */
export interface ForceOrderEvent {
  readonly e: 'forceOrder';
  readonly E: number;
  readonly o: {
    readonly s: string;
    /**
     * Side cua LENH THANH LY, khong phai cua vi the.
     * side=SELL => mot vi the LONG bi thanh ly.
     * side=BUY  => mot vi the SHORT bi thanh ly.
     */
    readonly S: 'BUY' | 'SELL';
    readonly o: string;
    readonly f: string;
    /** Khoi luong lenh. */
    readonly q: string;
    /** Gia lenh. */
    readonly p: string;
    /** Gia khop trung binh. */
    readonly ap: string;
    readonly X: string;
    /** Khoi luong da khop. */
    readonly l: string;
    readonly z: string;
    /** Trade time (ms). */
    readonly T: number;
  };
}

/** btcusdt@bookTicker — dinh so lenh. Khong co truong `e` trong combined stream. */
export interface BookTickerEvent {
  readonly e?: 'bookTicker';
  /** Order book update id. */
  readonly u: number;
  /** Event time (ms). */
  readonly E: number;
  /** Transaction time (ms). */
  readonly T: number;
  readonly s: string;
  /** Gia bid tot nhat. */
  readonly b: string;
  /** Khoi luong bid tot nhat. */
  readonly B: string;
  /** Gia ask tot nhat. */
  readonly a: string;
  /** Khoi luong ask tot nhat. */
  readonly A: string;
}

// ---------------------------------------------------------------------------
// Type guard — chay tren du lieu mang, khong tin cau truc
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isNumericString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && Number.isFinite(Number(v));
}

export function isCombinedEnvelope(v: unknown): v is CombinedStreamEnvelope {
  return isRecord(v) && typeof v['stream'] === 'string' && 'data' in v;
}

export function isAggTrade(v: unknown): v is AggTradeEvent {
  return (
    isRecord(v) &&
    v['e'] === 'aggTrade' &&
    typeof v['T'] === 'number' &&
    typeof v['a'] === 'number' &&
    typeof v['m'] === 'boolean' &&
    isNumericString(v['p']) &&
    isNumericString(v['q'])
  );
}

export function isTrade(v: unknown): v is TradeEvent {
  return (
    isRecord(v) &&
    v['e'] === 'trade' &&
    typeof v['T'] === 'number' &&
    typeof v['m'] === 'boolean' &&
    isNumericString(v['p']) &&
    isNumericString(v['q'])
  );
}

export function isForceOrder(v: unknown): v is ForceOrderEvent {
  if (!isRecord(v) || v['e'] !== 'forceOrder') return false;
  const o = v['o'];
  return (
    isRecord(o) &&
    (o['S'] === 'BUY' || o['S'] === 'SELL') &&
    typeof o['T'] === 'number' &&
    isNumericString(o['ap']) &&
    isNumericString(o['q'])
  );
}

export function isBookTicker(v: unknown): v is BookTickerEvent {
  return (
    isRecord(v) &&
    typeof v['u'] === 'number' &&
    isNumericString(v['b']) &&
    isNumericString(v['B']) &&
    isNumericString(v['a']) &&
    isNumericString(v['A'])
  );
}
