/**
 * Doi chieu ATR tinh bang TypeScript (FeatureEngine) voi ATR tinh bang SQL
 * (SignalStore.loadAtrHistory).
 *
 * Vi sao phai co test nay: hydration bom gia tri ATR tu DB vao bo loc che do. Neu hai
 * cong thuc lech nhau, worker sau khi restart se loc theo mot phan phoi KHAC voi luc
 * dang chay — va no khong bao loi, chi lam signal phat sai. Hai duong tinh phai cho
 * ra cung mot so, neu khong thi hydration con hai hon khong hydrate.
 *
 * Du lieu tong hop xac dinh (khong ngau nhien): gia = 78000 + 300*sin(i/600),
 * high = close + 50, low = close - 50. Giong het du lieu da nap vao Supabase.
 */
import { FeatureEngine } from '../src/features/engine.js';
import type { Bar1s } from '../src/bar/aggregator.js';

const BASE_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

function price(i: number): number {
  return 78_000 + 300 * Math.sin(i / 600);
}

function mkBar(i: number): Bar1s {
  const p = price(i);
  const c = BigInt(Math.round(p * 100));
  return {
    barTs: new Date(BASE_MS + i * 1000),
    availableAt: new Date(BASE_MS + i * 1000 + 1250),
    open: c,
    high: BigInt(Math.round((p + 50) * 100)),
    low: BigInt(Math.round((p - 50) * 100)),
    close: c,
    vwap: c,
    volume: 150_000_000n,
    quoteVolume: 0n,
    trades: 40,
    takerBuyVol: 90_000_000n,
    takerSellVol: 60_000_000n,
    bidPx: c - 10n, bidQty: 900_000_000n,
    askPx: c + 10n, askQty: 800_000_000n,
    spreadBpsAvg: 130n,
    bookUpdates: 500,
    liqLongQuote: 0n, liqShortQuote: 0n, liqCount: 0,
  };
}

// Gia tri SQL tra ve cho nen cuoi (01:25), lay tu truy van hydration tren Supabase.
const SQL_LAST_ATR_PCT = 0.25003;
const SQL_LAST_CLOSE = 78_124.09;

const fe = new FeatureEngine();
let lastSnap = null as ReturnType<FeatureEngine['snapshot']>;
// Goi snapshot() MOI BAR, dung nhu duong xu ly that — neu chi goi mot lan o cuoi thi
// phep kiem tra "lay mau 1/phut" khong chung minh duoc gi.
for (let i = 0; i < 5400; i += 1) {
  fe.push(mkBar(i));
  lastSnap = fe.snapshot();
}

let fails = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) fails += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`);
};

if (lastSnap === null) {
  console.log('FAIL snapshot tra null');
  process.exit(1);
}

const tsAtr = lastSnap.atr5mPct;
console.log('\n=== DOI CHIEU ATR(5m) % ===');
console.log(`  TypeScript (FeatureEngine) : ${tsAtr === null ? 'null' : tsAtr.toFixed(5)}`);
console.log(`  SQL (loadAtrHistory)       : ${SQL_LAST_ATR_PCT.toFixed(5)}`);

if (tsAtr === null) {
  check('TS tinh duoc ATR', false);
} else {
  const diffPct = Math.abs(tsAtr - SQL_LAST_ATR_PCT) / SQL_LAST_ATR_PCT * 100;
  console.log(`  Lech                       : ${diffPct.toFixed(2)} %`);
  // Hai ben gop nen 5 phut hoi khac nhau o bien cua so, nen cho phep lech nho.
  check('ATR hai duong khop trong 5%', diffPct < 5, `lech ${diffPct.toFixed(2)}%`);
}

console.log('\n=== DOI CHIEU GIA DONG ===');
const tsClose = lastSnap.mid;
console.log(`  TypeScript mid : ${tsClose === null ? 'null' : tsClose.toFixed(2)}`);
console.log(`  SQL close      : ${SQL_LAST_CLOSE.toFixed(2)}`);
if (tsClose !== null) {
  check('gia khop trong 0.1%', Math.abs(tsClose - SQL_LAST_CLOSE) / SQL_LAST_CLOSE < 0.001);
}

console.log(`\n=== TRANG THAI LICH SU ATR ===`);
const st = fe.atrHistoryStats;
console.log(`  mau: ${st.samples}   phu: ${st.spanHours} gio   san sang: ${st.ready}`);
// 90 phut du lieu, snapshot goi 5400 lan, nhung ATR chi tinh duoc sau ~20 phut dau.
// Neu con lay mau 1/giay thi day se la ~4200 mau; lay 1/phut thi ~70.
check('lay mau 1/phut, khong phai 1/giay',
  st.samples >= 60 && st.samples <= 80, `${st.samples} mau cho 90 phut (mong doi ~70)`);
check('khong phinh theo so lan goi snapshot', st.samples < 200, `${st.samples} << 5400 lan goi`);
check('chua du 6 gio -> chua san sang', !st.ready);
check('atrPercentile = null khi chua san sang', lastSnap.atrPercentile === null);
check('regime = CHUA_DU_DU_LIEU', lastSnap.regimeLabel === 'CHUA_DU_DU_LIEU');
check('regimeOk = false -> khong phat signal', !lastSnap.regimeOk);

console.log(fails === 0 ? '\n==> TAT CA PASS' : `\n==> ${fails} TEST HONG`);
process.exit(fails === 0 ? 0 : 1);
