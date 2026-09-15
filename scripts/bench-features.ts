/**
 * Do thoi gian FeatureEngine.snapshot().
 *
 * Ham nay chay MOI GIAY tren duong xu ly bar. Neu no ton gan 1 giay thi worker se
 * tut hau dan: bar don lai, hang doi ghi DB phinh ra, va cuoi cung la mat du lieu —
 * dung thu ma tieu chi Cua 1 phai chan. Phai do voi bo dem DAY nhu luc chay that,
 * khong phai bo dem rong luc vua khoi dong.
 */
import { FeatureEngine } from '../src/features/engine.js';
import type { Bar1s } from '../src/bar/aggregator.js';

const PRICE = 78_000;

function mkBar(i: number): Bar1s {
  const drift = Math.sin(i / 300) * 200 + (Math.random() - 0.5) * 30;
  const px = PRICE + drift;
  const c = BigInt(Math.round(px * 100));
  return {
    barTs: new Date(Date.now() - (14_400 - i) * 1000),
    availableAt: new Date(),
    open: c, high: c + 500n, low: c - 500n, close: c,
    volume: 150_000_000n,
    trades: 40,
    takerBuyVol: 90_000_000n,
    takerSellVol: 60_000_000n,
    vwap: c,
    quoteVolume: 7_800_000n,
    bidPx: c - 10n, bidQty: 900_000_000n,
    askPx: c + 10n, askQty: 800_000_000n,
    spreadBpsAvg: 130n,
    bookUpdates: 500,
    liqLongQuote: 0n, liqShortQuote: 0n, liqCount: 0,
  };
}

const fe = new FeatureEngine();
fe.setBookImbalance(120, 100);

console.log('Nap 4 gio bar (14.400 bar) va goi snapshot moi bar, dung nhu chay that...\n');

const samples: number[] = [];
let warmed = 0;

for (let i = 0; i < 14_400; i += 1) {
  fe.push(mkBar(i));
  const t0 = performance.now();
  const s = fe.snapshot();
  const dt = performance.now() - t0;
  if (s !== null) {
    samples.push(dt);
    if (s.atrPercentile !== null) warmed += 1;
  }
  if (i === 3_600 || i === 7_200 || i === 10_800 || i === 14_399) {
    const recent = samples.slice(-600);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const max = Math.max(...recent);
    console.log(
      `  sau ${String(i + 1).padStart(6)} bar (${String(Math.round((i + 1) / 3600)).padStart(1)}h): ` +
      `trung binh ${avg.toFixed(1).padStart(7)} ms   dinh ${max.toFixed(1).padStart(7)} ms   ` +
      `bo dem ${fe.barCount}`,
    );
  }
}

const last = samples.slice(-600);
const avg = last.reduce((a, b) => a + b, 0) / last.length;
const max = Math.max(...last);
const p99 = [...last].sort((a, b) => a - b)[Math.floor(last.length * 0.99)] ?? 0;

console.log('\n=== KET LUAN ===');
console.log(`  snapshot() trung binh : ${avg.toFixed(1)} ms`);
console.log(`  p99                   : ${p99.toFixed(1)} ms`);
console.log(`  dinh                  : ${max.toFixed(1)} ms`);
console.log(`  ngan sach moi giay    : 1000 ms`);
console.log(`  ty le dung ngan sach  : ${((avg / 1000) * 100).toFixed(1)} %`);
console.log(`  snapshot co che do    : ${warmed}`);

if (avg > 200) {
  console.log('\n  [X] QUA CHAM. Chiem tren 20% ngan sach moi giay, chua ke ingest va ghi DB.');
  process.exit(1);
} else if (avg > 50) {
  console.log('\n  [!] Hoi cham, nen toi uu.');
  process.exit(1);
} else {
  console.log('\n  [OK] Trong ngan sach.');
}
