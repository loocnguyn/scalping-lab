/**
 * Gui mot signal gia qua Telegram de xac minh cau hinh truoc khi tin.
 *
 * Chay: npm run test-telegram
 *
 * Vi sao can script rieng: neu doi toi signal that moi biet token sai thi co the mat
 * vai gio — va do dung la luc khong duoc mat. Loi Telegram cung bao lech tam: "chat
 * not found" thuong khong phai sai chat id ma la ban CHUA nhan tin cho bot lan nao,
 * nen bot khong duoc phep nhan tin truoc.
 */
import 'dotenv/config';
import { TELEGRAM } from '../src/config/index.js';
import { TelegramNotifier } from '../src/notify/telegram.js';
import type { Signal } from '../src/signal/engine.js';
import type { FeatureSnapshot } from '../src/features/engine.js';

if (!TELEGRAM.enabled) {
  console.error('\n[X] Chua cau hinh Telegram.\n');
  console.error('    1. Mo Telegram, nhan tin cho @BotFather -> /newbot -> dat ten');
  console.error('    2. Copy token, dan vao .env:  TELEGRAM_BOT_TOKEN=...');
  console.error('    3. NHAN TIN cho bot vua tao (bat ky tin gi) — bat buoc, neu khong');
  console.error('       bot khong duoc phep nhan tin cho ban truoc');
  console.error('    4. Mo https://api.telegram.org/bot<TOKEN>/getUpdates');
  console.error('       lay so trong result[0].message.chat.id');
  console.error('    5. Dan vao .env:  TELEGRAM_CHAT_ID=...\n');
  process.exit(1);
}

console.log('Token :', TELEGRAM.token.slice(0, 10) + '...' + TELEGRAM.token.slice(-4));
console.log('Chat  :', TELEGRAM.chatId);
console.log('');

function mkFeat(px: number): FeatureSnapshot {
  return {
    barTs: new Date(), availableAt: new Date(), mid: px,
    ofi10s: 1.4, cvd60s: 2.1, spreadBps: 0.013, spreadMedian1h: 0.013,
    vwapDev: -1.2, bookImb: 1.62, liqLong60s: 0, liqShort60s: 0,
    atr5mPct: 0.31, atrPercentile: 78, fundingPct: null, oiChg4h: null,
    minutesToFunding: null, range30mHigh: px * 1.006, range30mLow: px * 0.994,
    high15m: px * 1.003, low15m: px * 0.997, high4h: px * 1.012, vwap15m: px,
    regimeOk: true, regimeLabel: 'BIEN_DONG_CAO',
  };
}

function mkSignal(symbol: string, px: number, stopPts: number, tgtPts: number): Signal {
  return {
    id: 'test-' + symbol, ts: new Date(), symbol, setup: 'S3', side: 'LONG',
    entryPx: px, stopPx: px - stopPts, targetPx: px + tgtPts,
    expiresAt: new Date(Date.now() + 60_000), regime: 'BIEN_DONG_CAO',
    gated: false, gateReason: null, features: mkFeat(px),
    stopPoints: stopPts, targetPoints: tgtPts, rMultiple: tgtPts / stopPts,
  };
}

const tg = new TelegramNotifier();
await tg.start();

if (!tg.stats.enabled) {
  console.error('[X] Khong xac minh duoc bot — xem log loi ben tren.');
  process.exit(1);
}

// Gui ca hai hop dong, de thay khac biet ve thang so gia.
// BTC: TP 280 diem tren 78.400 = 0,36%. Vang: TP 15 diem tren 4.345 = 0,35%.
// Cung mot muc rui ro, hai con so diem hoan toan khac nhau — do la ly do rang buoc
// muc tieu phai tinh theo phan tram.
console.log('Dang gui 2 signal thu (BTC va vang)...');
tg.notifySignal(mkSignal('BTCUSDT', 78_400, 110, 280), {
  suggestedQty: () => 0.045,
  notionalLeverage: () => 3.53,
  recentStats: () => ({ n: 37, winRate: 0.46, expRNet: 0.081 }),
});
tg.notifySignal(mkSignal('XAUUSDT', 4_345, 6, 15), {
  suggestedQty: () => 0.83,
  notionalLeverage: () => 3.61,
  recentStats: () => null,
});

// notifySignal khong await (co chu y: mang cham khong duoc lam cham duong xu ly bar),
// nen doi o day de script bao duoc ket qua.
await new Promise((r) => setTimeout(r, 8_000));

const s = tg.stats;
console.log('');
console.log('Da gui  :', s.sent);
console.log('That bai:', s.failed);

if (s.sent > 0 && s.failed === 0) {
  console.log('\n[OK] Kiem tra Telegram — phai thay 2 tin nhan.\n');
  process.exit(0);
}
console.error('\n[X] Gui that bai. Xem log loi ben tren.\n');
process.exit(1);
