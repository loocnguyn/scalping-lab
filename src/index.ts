/**
 * scalping-lab — worker thuong tru, chay 24/24.
 *
 * VONG LAP DAY DU:
 *   WebSocket -> bar 1 giay -> feature -> signal engine -> paper broker
 *        ^                                                      |
 *        |                                                      v
 *   cong thich nghi  <---- expectancy rong sau phi <---- ket qua TP/SL
 *
 * SHADOW MODE (rang buoc cung #7). He thong TU dong vao lenh va do thang/thua,
 * nhung la lenh MO PHONG. Khong co dong code nao gui lenh len Binance, va se khong co
 * cho toi khi qua ca 4 cua o muc 8 ke hoach. Ket qua paper la thu duy nhat cho biet
 * co nen di tiep hay khong.
 *
 * KHONG deploy len Vercel serverless (rang buoc cung #6) — serverless khong giu duoc
 * WebSocket dai han. Dung Fly.io / Railway / VPS.
 */

import { randomUUID } from 'node:crypto';
import { BAR, DRY_RUN, GATE1, REGIME, STREAMS, SYMBOL, WS } from './config/index.js';
import { log, errFields } from './lib/logger.js';
import { pingDb, closeDb } from './db/pool.js';
import { BatchWriter } from './db/writer.js';
import { DryRunSink, type Sink } from './db/sink.js';
import { SignalStore } from './db/signal-store.js';
import { BarAggregator, type Bar1s } from './bar/aggregator.js';
import { ReconnectingStream } from './ws/client.js';
import { StreamRouter } from './ingest/router.js';
import { RestPoller } from './ingest/rest-poller.js';
import { UptimeTracker } from './health/uptime.js';
import { StreamHealth, probeStreams } from './ws/stream-health.js';
import { FeatureEngine } from './features/engine.js';
import { SignalEngine } from './signal/engine.js';
import { PaperBroker, DEFAULT_BROKER } from './paper/broker.js';
import { AdaptiveGate } from './learn/gate.js';
import { PRICE_SCALE } from './config/index.js';

const HEARTBEAT_MS = 60_000;
const REPORT_MS = 15 * 60_000;

function toNum(v: bigint | null): number | null {
  return v === null ? null : Number(v) / Number(PRICE_SCALE);
}

async function main(): Promise<void> {
  const workerId = `${process.env['FLY_MACHINE_ID'] ?? 'local'}-${randomUUID().slice(0, 8)}`;
  log.info('worker.start', {
    workerId, symbol: SYMBOL, streams: WS.streams,
    barIntervalMs: BAR.intervalMs, gate1Hours: GATE1.requiredContinuousHours,
    mode: 'SHADOW — paper trading, khong dat lenh that',
  });

  if (DRY_RUN) log.warn('worker.dry_run', { note: 'KHONG ghi DB, chi in ra stdout' });
  else await pingDb();

  // --- Probe: biet ngay stream nao that su co du lieu ---
  log.info('probe.start', { durationMs: 15_000 });
  const probe = await probeStreams(WS.baseUrl, STREAMS, 15_000);
  for (const spec of STREAMS) {
    const n = probe.get(spec.name) ?? 0;
    const level = n === 0 ? (spec.critical ? 'error' : 'warn') : 'info';
    log[level]('probe.stream', { stream: spec.name, msgIn15s: n, role: spec.role, critical: spec.critical });
  }
  const deadCritical = STREAMS.filter((s) => s.critical && (probe.get(s.name) ?? 0) === 0);
  if (deadCritical.length > 0) {
    log.error('probe.critical_streams_silent', {
      streams: deadCritical.map((s) => s.name),
      note: 'Worker van chay va ghi nhung gi con lai, nhung Tuan 1 CHUA the tinh la dat.',
    });
  }

  // --- Thanh phan ---
  const uptime = new UptimeTracker(workerId);
  const health = new StreamHealth();
  const writer: Sink = DRY_RUN ? new DryRunSink() : new BatchWriter();
  const store = new SignalStore();
  const features = new FeatureEngine();
  const rest = new RestPoller();
  const gate = new AdaptiveGate();

  if (!DRY_RUN) {
    gate.hydrate(await store.loadGateState());

    // Dung lai lich su ATR tu bar da luu, neu khong moi lan restart la cam 6 gio.
    const atrSamples = await store.loadAtrHistory(REGIME.atrLookbackDays);
    const kept = features.hydrateAtrHistory(atrSamples);
    const st = features.atrHistoryStats;
    log.info('features.atr_hydrated', {
      doc: atrSamples.length,
      giuLai: kept,
      phu: st.spanHours + ' gio',
      sanSang: st.ready,
      canToiThieu: REGIME.atrMinSamples,
      note: st.ready
        ? 'bo loc che do hoat dong ngay'
        : 'chua du lich su — he thong se im lang cho toi khi du',
    });
  }

  const broker = new PaperBroker(DEFAULT_BROKER, (p) => {
    // Vong nguoc: ket qua lenh quay lai dieu chinh cong loc.
    gate.record(p);
    if (!DRY_RUN) void store.saveOutcome(p);
    log.info('paper.closed', {
      setup: p.signal.setup,
      side: p.signal.side,
      outcome: p.outcome,
      rNet: p.rNet === null ? null : Math.round(p.rNet * 1000) / 1000,
      rGross: p.rGross === null ? null : Math.round(p.rGross * 1000) / 1000,
      pnlUsdtPerBtc: p.pnlNetUsdtPerBtc,
      feesUsdtPerBtc: p.feesUsdtPerBtc,
      mfe: Math.round(p.mfePoints),
      mae: Math.round(p.maePoints),
      gated: p.signal.gated,
    });
  });

  const signals = new SignalEngine({ isSetupEnabled: gate.isEnabled });

  // Snapshot gan nhat, de heartbeat bao duoc feature nao dang null.
  let lastSnapshot: ReturnType<FeatureEngine['snapshot']> = null;

  // --- Duong di cua mot bar ---
  const onBar = (bar: Bar1s): void => {
    writer.enqueueBar(bar);
    features.push(bar);

    // 1. Nhip gia cho cac lenh paper dang mo/pending.
    broker.onBar(toNum(bar.high), toNum(bar.low), toNum(bar.close), bar.availableAt);

    // 2. Tinh feature va danh gia setup.
    const snap = features.snapshot();
    if (snap === null) return;

    // Bo sung feature tu REST, giu nguyen ky luat available_at.
    const enriched = {
      ...snap,
      fundingPct: rest.fundingPercentile(),
      oiChg4h: rest.oiChange4h(),
      minutesToFunding: rest.minutesToFunding(),
    };
    lastSnapshot = enriched;

    for (const sig of signals.evaluate(enriched)) {
      log.info('signal.fired', {
        id: sig.id.slice(0, 8),
        setup: sig.setup,
        side: sig.side,
        entry: sig.entryPx.toFixed(1),
        stop: sig.stopPx.toFixed(1),
        target: sig.targetPx.toFixed(1),
        stopPts: Math.round(sig.stopPoints),
        targetPts: Math.round(sig.targetPoints),
        r: sig.rMultiple.toFixed(2),
        regime: sig.regime,
        gated: sig.gated,
        qtyBtc: broker.suggestedQtyBtc(sig),
        donBayDanhNghia: broker.notionalLeverage(sig).toFixed(2) + 'x',
      });
      if (!DRY_RUN) void store.saveSignal(sig);
      // Muc 0: theo doi CA signal bi chan. Khong co du lieu ve signal bi chan thi
      // khong bao gio biet cong loc chan dung hay chan nham.
      broker.submit(sig);
    }
  };

  const agg = new BarAggregator(onBar);
  const router = new StreamRouter(agg, writer, uptime, health, features);
  const stream = new ReconnectingStream(WS.streams, router.handle, (ev) => {
    if (!DRY_RUN) void uptime.record(ev);
  });

  writer.start();
  agg.start();
  health.start();
  await rest.start();
  stream.start();

  // --- Nhip theo doi suc khoe ---
  const heartbeat = setInterval(() => {
    const s = agg.stats;
    const stats = {
      barsEmitted: s.barsEmitted,
      barsWritten: writer.barsWritten,
      lateEvents: s.lateEvents,
      emptyBars: s.emptyBars,
      queueDepth: writer.queueDepth,
    };
    log.info('worker.heartbeat', uptime.summary({
      ...stats,
      trades: router.counters.trades,
      bookTickers: router.counters.bookTickers,
      forceOrders: router.counters.forceOrders,
      malformed: router.counters.malformed,
      barsBuffered: features.barCount,
      openPaper: broker.openPositions.length,
      closedPaper: broker.closedPositions.length,
    }));

    // Feature nao dang null — de setup khong bao gio kich hoat mot cach im lang.
    const fh = features.featureHealth(lastSnapshot);
    const thieu = Object.entries(fh).filter(([, ok]) => !ok).map(([k]) => k);
    log.info('features.health', {
      ...features.atrHistoryStats,
      che_do: lastSnapshot?.regimeLabel ?? 'chua co snapshot',
      dayDu: thieu.length === 0,
      dangNull: thieu,
    });
    if (!DRY_RUN) {
      void uptime.persistStats(stats);
      void store.saveStreamHealth(workerId, health.statuses());
      void store.saveStats(gate.stats());
    }

    const down = health.criticalDown;
    if (down.length > 0) {
      log.error('stream.critical_silent', {
        streams: down.map((d) => d.name),
        note: 'Ket noi van mo nhung stream bat buoc khong co du lieu — dang ghi bar rong.',
      });
    }
    if (!uptime.passesGate1) {
      log.warn('gate1.at_risk', {
        downtimePct: Math.round(uptime.downtimeRatio * 10_000) / 100,
        limitPct: GATE1.maxDowntimeRatio * 100,
      });
    }
  }, HEARTBEAT_MS);

  // --- Bao cao hieu qua dinh ky: co that su sinh loi nhuan khong? ---
  const report = setInterval(() => {
    const o = gate.overall();
    if (o === null) {
      log.info('perf.report', { note: 'chua co lenh paper nao dong lai' });
      return;
    }
    log.info('perf.report', {
      soLenh: o.n,
      winRate: Math.round(o.winRate * 1000) / 10 + '%',
      expRNet: Math.round(o.expRNet * 1000) / 1000,
      expRGross: Math.round(o.expRGross * 1000) / 1000,
      tongRNet: Math.round(o.totalRNet * 100) / 100,
      ketLuan: o.verdict,
    });
    for (const b of gate.stats().slice(0, 6)) {
      log.info('perf.bucket', {
        setup: b.setup, regime: b.regime, gioUtc: b.hourBucket,
        n: b.n, wr: Math.round(b.winRate * 100) + '%',
        expRNet: Math.round(b.expRNet * 1000) / 1000,
        nofill: Math.round(b.nofillRate * 100) + '%',
        enabled: b.enabled,
      });
    }
  }, REPORT_MS);

  // --- Tat may sach se ---
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('worker.shutdown', { signal, ...uptime.summary({}) });
    clearInterval(heartbeat);
    clearInterval(report);
    stream.stop();
    health.stop();
    rest.stop();
    agg.stop();
    await writer.stop();
    if (!DRY_RUN) await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  // Khong bao gio de mot loi le lam chet process im lang — uptime la tieu chi Cua 1.
  process.on('unhandledRejection', (e) => { log.error('unhandled_rejection', errFields(e)); });
  process.on('uncaughtException', (e) => { log.error('uncaught_exception', errFields(e)); });
}

main().catch((e: unknown) => {
  log.error('worker.fatal', errFields(e));
  process.exit(1);
});
