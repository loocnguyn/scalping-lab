/**
 * Kiem chung RollingPercentile — dac biet la lo hong da tim thay:
 * cua so phai dung bang so ngay khai bao, ke ca sau nhieu ngay chay lien tuc.
 */
import { RollingPercentile } from '../src/features/rolling.js';

let fails = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (!cond) fails += 1;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`);
}

const DAY = 24 * 3600_000;
const MIN = 60_000;

// --- 1. Chua du mau thi tra ve null, khong doan bua ---
{
  const r = new RollingPercentile({ windowMs: 7 * DAY, sampleIntervalMs: MIN, minSamples: 360 });
  let t = 0;
  for (let i = 0; i < 100; i += 1) { r.push(t, 0.3); t += MIN; }
  check('chua du mau -> percentileOf tra null', r.percentileOf(0.3) === null, `size=${r.size}`);
  check('chua du mau -> ready = false', !r.ready);
}

// --- 2. LOI DA TIM THAY: chay 7 ngay, cua so phai van la 7 ngay ---
{
  const r = new RollingPercentile({ windowMs: 7 * DAY, sampleIntervalMs: MIN, minSamples: 360 });
  let t = 0;
  // 10 ngay lien tuc, lay mau moi giay (dung nhu duong xu ly bar goi)
  for (let d = 0; d < 10 * DAY; d += 1000) {
    r.push(t, 0.2 + Math.sin(t / (6 * 3600_000)) * 0.1);
    t += 1000;
  }
  const spanDays = r.spanMs / DAY;
  console.log(`     sau 10 ngay: size=${r.size}  span=${spanDays.toFixed(2)} ngay`);
  check('cua so giu dung ~7 ngay', spanDays > 6.9 && spanDays <= 7.01, `span=${spanDays.toFixed(3)}`);
  // 7 ngay / 1 phut = 10080 mau (+/- 1)
  check('lay mau 1/phut -> ~10080 mau', r.size >= 10_070 && r.size <= 10_085, `size=${r.size}`);
}

// --- 3. Percentile dung ve mat so hoc ---
{
  const r = new RollingPercentile({ windowMs: 7 * DAY, sampleIntervalMs: MIN, minSamples: 10 });
  let t = 0;
  // 100 mau: gia tri 0..99
  for (let i = 0; i < 100; i += 1) { r.push(t, i); t += MIN; }
  check('percentileOf(50) = 50%', r.percentileOf(50) === 50, `= ${r.percentileOf(50)}`);
  check('percentileOf(0) = 0%', r.percentileOf(0) === 0, `= ${r.percentileOf(0)}`);
  check('percentileOf(1000) = 100%', r.percentileOf(1000) === 100, `= ${r.percentileOf(1000)}`);
}

// --- 4. Mau den day hon sampleInterval thi bi bo ---
{
  const r = new RollingPercentile({ windowMs: 7 * DAY, sampleIntervalMs: MIN, minSamples: 1 });
  check('mau dau tien duoc giu', r.push(0, 1) === true);
  check('mau sau 1 giay bi bo', r.push(1000, 2) === false);
  check('mau sau 1 phut duoc giu', r.push(MIN, 3) === true);
  check('size = 2', r.size === 2, `= ${r.size}`);
}

// --- 5. Gia tri khong hop le bi tu choi, khong lam ban phan phoi ---
{
  const r = new RollingPercentile({ windowMs: 7 * DAY, sampleIntervalMs: 0, minSamples: 1 });
  check('NaN bi tu choi', r.push(0, Number.NaN) === false);
  check('Infinity bi tu choi', r.push(1, Number.POSITIVE_INFINITY) === false);
  check('size van = 0', r.size === 0);
}

// --- 6. Bo nho khong phinh vo han khi chay dai ngay ---
{
  const r = new RollingPercentile({ windowMs: 1 * DAY, sampleIntervalMs: MIN, minSamples: 10 });
  let t = 0;
  for (let d = 0; d < 60 * DAY; d += 30_000) { r.push(t, Math.random()); t += 30_000; }
  // 1 ngay / 1 phut = 1440 mau, du da chay 60 ngay
  check('chay 60 ngay, cua so 1 ngay -> ~1440 mau', r.size >= 1_435 && r.size <= 1_445, `size=${r.size}`);
}

// --- 7. Toc do: percentileOf tren cua so 7 ngay day ---
{
  const r = new RollingPercentile({ windowMs: 7 * DAY, sampleIntervalMs: MIN, minSamples: 360 });
  let t = 0;
  for (let d = 0; d < 7 * DAY; d += MIN) { r.push(t, Math.random()); t += MIN; }
  const t0 = performance.now();
  for (let i = 0; i < 1000; i += 1) r.percentileOf(0.5);
  const per = (performance.now() - t0) / 1000;
  console.log(`     percentileOf tren ${r.size} mau: ${per.toFixed(3)} ms/lan`);
  check('percentileOf duoi 1 ms', per < 1, `${per.toFixed(3)} ms`);
}

console.log(fails === 0 ? '\n==> TAT CA PASS' : `\n==> ${fails} TEST HONG`);
process.exit(fails === 0 ? 0 : 1);
