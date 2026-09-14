/**
 * Kiem chung bo tinh tien cua paper broker bang cach doi chieu voi bang o muc 1
 * ke hoach. Neu so o day lech voi bang do, mot trong hai cho dang sai — va phai
 * tim ra cho nao truoc khi tin bat ky ket qua nao cua he thong.
 */
import { PaperBroker, type BrokerConfig } from '../src/paper/broker.js';
import type { Signal } from '../src/signal/engine.js';
import type { FeatureSnapshot } from '../src/features/engine.js';

const PX = 77324;

const feat: FeatureSnapshot = {
  barTs: new Date(), availableAt: new Date(), mid: PX,
  ofi10s: 1, cvd60s: 1, spreadBps: 0.013, spreadMedian1h: 0.013,
  vwapDev: 0, bookImb: 1.6, liqLong60s: 0, liqShort60s: 0,
  atr5mPct: 0.3, atrPercentile: 80, fundingPct: null, oiChg4h: null,
  minutesToFunding: null, range30mHigh: PX + 500, range30mLow: PX - 500,
  high15m: PX + 200, low15m: PX - 200, high4h: PX + 800, vwap15m: PX,
  regimeOk: true, regimeLabel: 'BIEN_DONG_CAO',
};

function mkSignal(side: 'LONG' | 'SHORT', entry: number, stop: number, target: number): Signal {
  return {
    id: 'test-' + side + '-' + target, ts: new Date(), setup: 'S3', side,
    entryPx: entry, stopPx: stop, targetPx: target,
    expiresAt: new Date(Date.now() + 60_000), regime: 'BIEN_DONG_CAO',
    gated: false, gateReason: null, features: feat,
    stopPoints: Math.abs(entry - stop), targetPoints: Math.abs(target - entry),
    rMultiple: Math.abs(target - entry) / Math.abs(entry - stop),
  };
}

const cfg: BrokerConfig = { maxHoldSec: 3600, riskPctPerTrade: 0.5, accountUsdt: 1000 };

let fails = 0;
function check(name: string, got: number | null, want: number, tol = 0.02): void {
  const ok = got !== null && Math.abs(got - want) <= tol;
  if (!ok) fails += 1;
  const g = got === null ? 'null' : got.toFixed(3);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(46)} ${g.padStart(9)}` + (ok ? '' : `  (mong doi ~${want})`));
}

// --- 1. LONG cham TP: TP 250 diem, SL 100 diem, vao/ra deu maker ---
{
  const b = new PaperBroker(cfg);
  const s = mkSignal('LONG', PX, PX - 100, PX + 250);
  const p = b.submit(s);
  const t = new Date();
  b.onBar(PX + 1, PX - 1, PX, t);           // xuyen qua gia limit -> khop
  b.onBar(PX + 260, PX, PX + 255, t);       // cham TP
  console.log('\n--- LONG cham TP (TP250 / SL100, maker ca hai dau) ---');
  console.log('    outcome =', p.outcome, ' phi =', p.feesUsdtPerBtc, 'USDT/BTC');
  check('phi khu hoi maker ~30.9 USDT', p.feesUsdtPerBtc, 30.9, 0.3);
  check('lai rong ~ 250 - 30.9 = 219.1', p.pnlNetUsdtPerBtc, 219.1, 0.4);
  check('R rong ~ 2.191', p.rNet, 2.191, 0.01);
  check('R gop = 2.5', p.rGross, 2.5, 0.01);
}

// --- 2. LONG cham SL: vao maker, cat lo bang stop-market (taker) + truot 1 tick ---
{
  const b = new PaperBroker(cfg);
  const s = mkSignal('LONG', PX, PX - 100, PX + 250);
  const p = b.submit(s);
  const t = new Date();
  b.onBar(PX + 1, PX - 1, PX, t);
  b.onBar(PX, PX - 150, PX - 140, t);       // cham SL
  console.log('\n--- LONG cham SL (vao maker, ra taker + truot 1 tick) ---');
  console.log('    outcome =', p.outcome, ' phi =', p.feesUsdtPerBtc, 'USDT/BTC');
  // phi = maker(15.46) + taker(38.63) ~ 54.1
  check('phi maker+taker ~54.1 USDT', p.feesUsdtPerBtc, 54.1, 0.4);
  check('lo rong ~ -(100 + 0.1 + 54.1)', p.pnlNetUsdtPerBtc, -154.2, 0.5);
  check('R rong ~ -1.542', p.rNet, -1.542, 0.02);
}

// --- 3. Cham CA TP va SL trong cung mot giay => phai tinh la SL (bi quan #2) ---
{
  const b = new PaperBroker(cfg);
  const s = mkSignal('LONG', PX, PX - 100, PX + 250);
  const p = b.submit(s);
  const t = new Date();
  b.onBar(PX + 1, PX - 1, PX, t);
  b.onBar(PX + 300, PX - 150, PX, t);       // cham ca hai
  console.log('\n--- Cham ca TP va SL trong cung mot giay ---');
  console.log('    outcome =', p.outcome, '(phai la sl)');
  if (p.outcome !== 'sl') { fails += 1; console.log('FAIL phai tinh la SL'); }
  else console.log('OK   tinh la SL, dung nguyen tac bi quan');
}

// --- 4. Chi CHAM gia limit chu khong xuyen qua => KHONG khop (bi quan #1) ---
{
  const b = new PaperBroker(cfg);
  const s = mkSignal('LONG', PX, PX - 100, PX + 250);
  const p = b.submit(s);
  const t = new Date();
  b.onBar(PX + 5, PX, PX + 2, t);           // low == entry, cham chu khong xuyen
  console.log('\n--- Chi cham gia limit, khong xuyen qua ---');
  console.log('    status =', p.status, '(phai con pending)');
  if (p.status !== 'pending') { fails += 1; console.log('FAIL le ra chua duoc khop'); }
  else console.log('OK   chua khop — dung mo hinh xep hang so lenh');
}

// --- 5. Het han ma khong khop => nofill, khong tinh vao thang/thua ---
{
  const b = new PaperBroker(cfg);
  const s = mkSignal('LONG', PX, PX - 100, PX + 250);
  const p = b.submit(s);
  b.onBar(PX + 50, PX + 10, PX + 20, new Date(Date.now() + 120_000));
  console.log('\n--- Het han khong khop ---');
  console.log('    outcome =', p.outcome, ' rNet =', p.rNet);
  if (p.outcome !== 'nofill' || p.rNet !== null) { fails += 1; console.log('FAIL phai la nofill voi rNet = null'); }
  else console.log('OK   nofill, khong tinh vao thong ke thang/thua');
}

// --- 6. SHORT doi xung ---
{
  const b = new PaperBroker(cfg);
  const s = mkSignal('SHORT', PX, PX + 100, PX - 250);
  const p = b.submit(s);
  const t = new Date();
  b.onBar(PX + 1, PX - 1, PX, t);           // xuyen len tren -> khop short
  b.onBar(PX - 240, PX - 260, PX - 250, t); // cham TP
  console.log('\n--- SHORT cham TP ---');
  check('R rong ~ 2.191', p.rNet, 2.191, 0.01);
}

// --- 7. Khoi luong tinh TU khoang cach stop, va don bay danh nghia ---
{
  const b = new PaperBroker(cfg);
  const s = mkSignal('LONG', PX, PX - 100, PX + 250);
  console.log('\n--- Khoi luong va don bay (tai khoan 1000 USDT, rui ro 0.5%) ---');
  const qty = b.suggestedQtyBtc(s);
  const lev = b.notionalLeverage(s);
  console.log('    qty =', qty, 'BTC   don bay danh nghia =', lev.toFixed(2) + 'x');
  check('qty ~ 5 USDT / 100 diem = 0.05 BTC', qty, 0.05, 0.001);
  check('don bay danh nghia ~3.87x', lev, 3.87, 0.05);
}

console.log(fails === 0 ? '\n==> TAT CA PASS' : `\n==> ${fails} TEST HONG`);
process.exit(fails === 0 ? 0 : 1);
