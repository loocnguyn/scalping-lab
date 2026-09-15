/**
 * Kiem chung lop so co thang (src/lib/fixed.ts).
 *
 * Rang buoc cung: khong dung float cho tinh toan tien. Lop nay la cho duy nhat cuong
 * che dieu do, nen no phai duoc kiem tra truoc moi thu khac — neu no sai thi moi con
 * so P&L phia sau deu sai theo, va sai mot cach am tham.
 */
import { parseFixed, formatFixed, notional, spreadBps, weightedMean } from '../src/lib/fixed.js';

const P = 100n;            // gia: 1 don vi = 0.01 USDT
const Q = 100_000_000n;    // khoi luong: 1 don vi = 1e-8 BTC

let fails = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const ok = String(got) === String(want);
  if (!ok) fails += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(40)} ${String(got)}${ok ? '' : `   (mong doi ${String(want)})`}`);
}

console.log('=== PARSE ===');
eq('parse "77324.10"', parseFixed('77324.10', P), 7732410n);
eq('parse "77324.1" (thieu chu so)', parseFixed('77324.1', P), 7732410n);
eq('parse "77324" (khong phan le)', parseFixed('77324', P), 7732400n);
eq('parse cat bot chu so thua', parseFixed('77324.199', P), 7732419n);
eq('parse khoi luong "0.001"', parseFixed('0.001', Q), 100_000n);
eq('parse so am', parseFixed('-12.34', P), -1234n);

console.log('\n=== FORMAT ===');
eq('format 7732410n', formatFixed(7732410n, P), '77324.10');
eq('format so am', formatFixed(-1234n, P), '-12.34');
eq('format so nho hon 1', formatFixed(5n, P), '0.05');
eq('round-trip "0.1"', formatFixed(parseFixed('0.1', P), P), '0.10');

console.log('\n=== DIEU MA FLOAT LAM SAI ===');
const a = parseFixed('0.1', P) + parseFixed('0.2', P);
eq('0.1 + 0.2 === 0.3', formatFixed(a, P), '0.30');
console.log(`     (float thuan: 0.1 + 0.2 = ${0.1 + 0.2})`);

console.log('\n=== GIA TRI DANH NGHIA ===');
eq('1 BTC @ 77324.10', formatFixed(notional(7732410n, 100_000_000n, Q), P), '77324.10');
eq('0.5 BTC @ 77324.10', formatFixed(notional(7732410n, 50_000_000n, Q), P), '38662.05');
eq('0.001 BTC @ 77324.10', formatFixed(notional(7732410n, 100_000n, Q), P), '77.32');

console.log('\n=== VWAP ===');
eq('trung binh co trong so', weightedMean(7732410n * 2n, 2n), 7732410n);
eq('chia cho 0 -> null', weightedMean(5n, 0n), null);

console.log('\n=== SPREAD ===');
// bid 77324.00 / ask 77324.10 -> (0.1 / 77324.05) * 10000 = 0.01293 bps
const s = spreadBps(7732400n, 7732410n);
eq('spread 1 tick @ 77324', s === null ? 'null' : formatFixed(s, 10_000n), '0.0129');
eq('spread khi mid = 0 -> null', spreadBps(0n, 0n), null);

console.log('\n=== TICH LUY KHONG TROI SO ===');
let acc = 0n;
for (let i = 0; i < 1_000_000; i += 1) acc += parseFixed('0.01', P);
eq('cong 0.01 mot trieu lan', formatFixed(acc, P), '10000.00');
let facc = 0;
for (let i = 0; i < 1_000_000; i += 1) facc += 0.01;
console.log(`     (float thuan cho: ${facc.toFixed(10)} — lech ${Math.abs(facc - 10000).toExponential(2)})`);

console.log('\n=== TU CHOI DAU VAO HONG ===');
for (const bad of ['', 'abc', '1.2.3', '12,34', 'NaN', '1e5']) {
  let threw = false;
  try { parseFixed(bad, P); } catch { threw = true; }
  eq(`parse ${JSON.stringify(bad)} nem loi`, threw, true);
}

console.log(fails === 0 ? '\n==> TAT CA PASS' : `\n==> ${fails} TEST HONG`);
process.exit(fails === 0 ? 0 : 1);
