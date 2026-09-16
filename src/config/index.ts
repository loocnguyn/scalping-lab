/**
 * Nguon su that duy nhat cho moi hang so cua he thong.
 * CLAUDE.md / Quy uoc code: "Moi hang so nguong ... nam trong mot file config duy nhat,
 * khong rai rac trong logic."
 *
 * Tuan 1 chi dung nhom SYMBOL / SCALE / WS / DB. Cac nhom FEE, TARGET, REGIME duoc khai bao
 * san vi chung la rang buoc cung o muc 1 cua ke hoach — signal engine (Tuan 4) se doc lai
 * day, khong duoc dinh nghia lai cho nao khac.
 */

import 'dotenv/config';

function env(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Thieu bien moi truong bat buoc: ${key}`);
  }
  return v;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`${key} phai la so nguyen, nhan duoc: ${v}`);
  return n;
}

// ---------------------------------------------------------------------------
// Hop dong giao dich
// ---------------------------------------------------------------------------

export const SYMBOL = env('SYMBOL', 'btcusdt').toLowerCase();

/**
 * Quy doi gia/khoi luong ve SO NGUYEN. CLAUDE.md cam dung float cho tinh toan tien.
 * BTCUSDT perp: tickSize 0.10, stepSize 0.001. Ta dung thang min hon tick/step that
 * de con cho cho gia trung binh (VWAP) va cac hop dong khac.
 */
export const PRICE_SCALE = 100n; // 1 don vi = 0.01 USDT
export const QTY_SCALE = 100_000_000n; // 1 don vi = 1e-8 BTC

/** 1 "diem" BTC theo cach noi trong ke hoach = 1.00 USDT bien dong gia. */
export const POINT_IN_PRICE_UNITS = 100n; // 1 diem = 100 don vi PRICE_SCALE

// ---------------------------------------------------------------------------
// Phi — muc 1 ke hoach. Moi tinh toan P&L PHAI tru phi.
// ---------------------------------------------------------------------------

export const FEES = {
  /** Binance USD-M VIP 0. Kiem tra lai khi trien khai. */
  makerRate: 0.0002,
  takerRate: 0.0005,
  /** Tra phi bang BNB giam them 10%. */
  bnbDiscount: 0.9,
} as const;

// ---------------------------------------------------------------------------
// Rang buoc cung ve muc tieu — muc 1, ket luan 1
// ---------------------------------------------------------------------------

export const TARGET = {
  /**
   * Muc tieu toi thieu, tinh theo PHAN TRAM gia — khong phai so diem tuyet doi.
   *
   * Ke hoach viet "250 diem BTC (~0.32% o gia 77k)". Con so that la 0,32%; 250 diem
   * chi la cach doc no o mot muc gia cu the. Ap thang 250 diem sang vang (gia ~4.345)
   * se thanh 5,75% — vo ly, va se khong bao gio co signal nao.
   *
   * Ly do goc van giu nguyen: TP qua nho thi phi an het loi the. TP 100 diem tren BTC
   * can win rate 88,7% de hoa von.
   */
  minTargetPct: 0.32,
  /** Vao lenh mac dinh la limit (maker), khong phai market. */
  defaultEntryType: 'limit' as const,
  /** Huy lenh pending neu khong khop trong khoang nay. */
  pendingTimeoutSec: { S1: 30, S2: 180, S3: 60 },
} as const;

// ---------------------------------------------------------------------------
// Bo loc che do thi truong — muc 4. Dung TRUOC moi rule.
// ---------------------------------------------------------------------------

export const REGIME = {
  /** atr_5m_pct duoi percentile nay cua 7 ngay gan nhat => khong phat signal nao. */
  atrPercentileFloor: 40,
  atrLookbackDays: 7,

  /**
   * Khoang cach giua hai mau ATR duoc giu de tinh percentile.
   *
   * ATR(5m) gan nhu khong doi giua hai giay lien tiep. Lay mau moi giay cho ra cung
   * mot phan phoi nhung ton gap 60 lan bo nho — va 7 ngay x 1 mau/giay = 604.800 mau,
   * vuot moi cap hop ly, dung la nguyen nhan khien cua so tung bi thu con 2,31 ngay.
   */
  atrSampleIntervalMs: 60_000,

  /**
   * So mau toi thieu truoc khi tin percentile. 360 mau x 1 phut = 6 gio.
   *
   * Duoi muc nay he thong KHONG phat signal nao — co chu y. Percentile tinh tu 10 phut
   * ATR gan nhu y het nhau la con so ngau nhien doi lot khoa hoc, va no quyet dinh
   * bo loc dung truoc moi rule. Im lang 6 gio dau con hon phat bua.
   */
  atrMinSamples: 360,
  /** spread > boi so nay cua trung vi 1h => khong phat signal. */
  spreadMedianMultiplier: 2,
} as const;

// ---------------------------------------------------------------------------
// WebSocket + do ben ket noi
// ---------------------------------------------------------------------------

/**
 * Khai bao stream kem KY VONG VE TAN SUAT.
 *
 * Vi sao co `minMsgPerMin`: mot WebSocket co the "mo" ma van khong gui gi tren mot
 * stream cu the. Do da xay ra that voi endpoint futures — @aggTrade, @kline_*,
 * @forceOrder, @markPrice im lang hoan toan trong nhieu phut trong khi @trade va
 * @bookTicker chay binh thuong. Neu chi do ket noi cap socket, worker se bao "uptime
 * 100%" trong khi dang ghi bar rong. Do la mat du lieu ma khong biet — dung thu ma
 * tieu chi Cua 1 phai chan.
 *
 * `role` cho biet thieu stream nay thi hong cai gi o phia sau.
 */
export interface StreamSpec {
  readonly name: string;
  readonly role: string;
  /** Duoi nguong nay coi la im lang bat thuong. 0 = thua thot tu nhien, khong canh bao. */
  readonly minMsgPerMin: number;
  /** true = thieu la khong the hoan thanh Tuan 1. */
  readonly critical: boolean;
}

export const STREAMS: readonly StreamSpec[] = [
  {
    name: `${SYMBOL}@trade`,
    role: 'Giao dich khop lenh — OHLCV, CVD, VWAP',
    minMsgPerMin: 60,
    critical: true,
  },
  {
    name: `${SYMBOL}@bookTicker`,
    role: 'Dinh so lenh — spread_bps, best bid/ask',
    minMsgPerMin: 300,
    critical: true,
  },
  {
    name: `${SYMBOL}@forceOrder`,
    role: 'Thanh ly — nen cua setup S1',
    // Thanh ly thua thot that su: co the im hang chuc phut khi thi truong yen.
    // Khong the phan biet "khong co thanh ly" voi "stream chet" bang tan suat,
    // nen de 0 va theo doi rieng qua probe luc khoi dong.
    minMsgPerMin: 0,
    critical: false,
  },
  {
    name: `${SYMBOL}@depth20@100ms`,
    role: 'Do sau so lenh — book_imb (Tuan 2)',
    minMsgPerMin: 300,
    critical: false,
  },
] as const;

export const WS = {
  baseUrl: env('BINANCE_WS_BASE', 'wss://fstream.binance.com/stream'),
  streams: STREAMS.map((s) => s.name),
  /** Exponential backoff khi mat ket noi. */
  reconnect: {
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
    jitterRatio: 0.2,
  },
  /**
   * Binance gui ping moi 3 phut va dong ket noi neu khong pong trong 10 phut.
   * Ta chu dong coi ket noi la chet neu khong co message NAO trong khoang nay.
   */
  stalenessTimeoutMs: 30_000,
  /** Binance dong ket noi sau 24h. Ta tu xoay truoc de khong bi dut bat ngo. */
  proactiveCycleMs: 23 * 60 * 60 * 1_000,
  /** Chu ky danh gia tan suat tung stream. */
  healthWindowMs: 60_000,
} as const;

// ---------------------------------------------------------------------------
// Bar 1 giay + ghi DB
// ---------------------------------------------------------------------------

export const BAR = {
  intervalMs: 1_000,
  /**
   * Cho them khoang nay sau khi giay ket thuc roi moi dong bar, de don trade den tre.
   * Trade den sau moc nay bi tinh la late va ghi vao ingest_gaps.
   */
  latenessGraceMs: 250,
} as const;

/**
 * Dung chuoi ket noi Postgres.
 *
 * Uu tien DATABASE_URL neu co. Neu khong, dung tu SUPABASE_PROJECT_REF +
 * SUPABASE_DB_PASSWORD.
 *
 * Vi sao co duong thu hai: mat khau Supabase sinh tu dong thuong chua ky tu dac biet
 * (@ ? # / :) — dan thang vao chuoi URL la hong, va loi bao ra se la "khong phan giai
 * duoc host" chu khong phai "sai mat khau", rat mat thoi gian de tim. Ghep bang
 * encodeURIComponent thi khong bao gio dinh chuyen do.
 */
function buildDbUrl(): string {
  const direct = process.env['DATABASE_URL'];
  if (direct !== undefined && direct !== '') return direct;

  const ref = process.env['SUPABASE_PROJECT_REF'];
  const pwd = process.env['SUPABASE_DB_PASSWORD'];
  const region = process.env['SUPABASE_REGION'] ?? 'ap-southeast-1';

  if (ref !== undefined && ref !== '' && pwd !== undefined && pwd !== '') {
    return 'postgresql://postgres.' + ref + ':' + encodeURIComponent(pwd) +
           '@aws-0-' + region + '.pooler.supabase.com:5432/postgres';
  }

  if (DRY_RUN) return 'postgresql://dry-run/none';
  throw new Error(
    'Thieu chuoi ket noi DB. Dat DATABASE_URL, hoac dat SUPABASE_PROJECT_REF va ' +
    'SUPABASE_DB_PASSWORD trong .env. Chay `npm run check-db` de kiem tra.',
  );
}

/**
 * Che do chay thu: doc WebSocket va gop bar binh thuong nhung KHONG ghi DB, in bar ra stdout.
 * Dung de kiem chung duong ingest truoc khi co chuoi ket noi Postgres.
 */
export const DRY_RUN = process.env['DRY_RUN'] === '1';

export const DB = {
  /** Getter de chi tinh khi that su dung. Script chi test thong bao khong can DB. */
  get url(): string { return buildDbUrl(); },
  flushIntervalMs: envInt('FLUSH_INTERVAL_MS', 2_000),
  /** So bar toi da gom truoc khi ep ghi, tranh phinh bo nho neu DB cham. */
  maxQueueSize: 5_000,
  poolMax: envInt('PG_POOL_MAX', 4),
  statementTimeoutMs: 15_000,
} as const;

// ---------------------------------------------------------------------------
// Tieu chi qua Cua 1 — muc 8. Worker tu do chinh no.
// ---------------------------------------------------------------------------

export const GATE1 = {
  /** He thong khong duoc mat ket noi qua 0.5% thoi gian. */
  maxDowntimeRatio: 0.005,
  /** Tieu chi hoan thanh Tuan 1: chay 72h lien tuc khong mat du lieu. */
  requiredContinuousHours: 72,
} as const;

// ---------------------------------------------------------------------------
// Thong bao email — thu bien he thong thanh dung duoc that
// ---------------------------------------------------------------------------

/**
 * SMTP. Voi Gmail: host smtp.gmail.com, port 587, user la dia chi Gmail, va pass
 * phai la APP PASSWORD (16 ky tu) — KHONG phai mat khau tai khoan. Google chan
 * dang nhap bang mat khau thuong tu 2022.
 *
 * Dung duoc voi moi nha cung cap SMTP khac (Resend, Mailgun, SendGrid) chi bang
 * cach doi 4 bien nay.
 */
export const MAIL = {
  host: process.env['SMTP_HOST'] ?? 'smtp.gmail.com',
  port: envInt('SMTP_PORT', 587),
  user: process.env['SMTP_USER'] ?? '',
  pass: process.env['SMTP_PASS'] ?? '',
  to: process.env['ALERT_EMAIL_TO'] ?? process.env['SMTP_USER'] ?? '',
  from: process.env['ALERT_EMAIL_FROM'] ?? `scalping-lab <${process.env['SMTP_USER'] ?? ''}>`,
  /**
   * Tran so email moi gio. Chan spam khi co su co lap lai — mot loi lap moi giay
   * se lam day hop thu va co the khien Google khoa tai khoan.
   */
  maxPerHour: envInt('MAIL_MAX_PER_HOUR', 20),
  get enabled(): boolean {
    return this.user !== '' && this.pass !== '' && this.to !== '';
  },
} as const;

/**
 * Telegram. Lay token tu @BotFather, va chat id bang cach nhan tin cho bot roi mo
 * https://api.telegram.org/bot<TOKEN>/getUpdates
 *
 * Vi sao Telegram thay vi email: signal song 30-180 giay. Email mat 5-30 giay de toi
 * va nguoi ta khong mo mail ngay; Telegram day thang vao man hinh khoa.
 */
export const TELEGRAM = {
  token: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
  chatId: process.env['TELEGRAM_CHAT_ID'] ?? '',
  timeoutMs: envInt('TELEGRAM_TIMEOUT_MS', 10_000),
  /** Telegram khoa bot neu vuot gioi han; mot su co lap moi giay du de bi khoa. */
  maxPerHour: envInt('TELEGRAM_MAX_PER_HOUR', 30),
  get enabled(): boolean {
    return this.token !== '' && this.chatId !== '';
  },
} as const;

export const LOG_LEVEL = env('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error';
