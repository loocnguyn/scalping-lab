/**
 * Ghi signal, ket qua, va thong ke setup xuong DB.
 *
 * Muc 0 cua tang tu hoc: "Moi signal phat ra, KE CA signal bi cong loc chan, luu kem
 * toan bo anh chup feature tai thoi diem do." Khong co lop nay thi khong co gi de hoc.
 * Signal bi chan cung phai luu — neu chi luu signal duoc phat, se khong bao gio biet
 * cong loc chan dung hay chan nham.
 */

import { pool } from './pool.js';
import { log, errFields } from '../lib/logger.js';
import type { Signal } from '../signal/engine.js';
import type { PaperPosition } from '../paper/broker.js';
import type { BucketStats } from '../learn/gate.js';
import type { StreamStatus } from '../ws/stream-health.js';

export class SignalStore {
  async saveSignal(s: Signal): Promise<void> {
    try {
      await pool.query(
        `insert into signals (
           id, ts, available_at, symbol, setup, side, entry_px, stop_px, target_px,
           expires_at, stop_points, target_points, r_multiple, regime, gated,
           gate_reason, features
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         on conflict (id) do nothing`,
        [
          s.id, s.ts, s.features.availableAt, s.symbol, s.setup, s.side,
          s.entryPx.toFixed(2), s.stopPx.toFixed(2), s.targetPx.toFixed(2), s.expiresAt,
          s.stopPoints.toFixed(2), s.targetPoints.toFixed(2), s.rMultiple.toFixed(3),
          s.regime, s.gated, s.gateReason,
          JSON.stringify(s.features),
        ],
      );
    } catch (e) {
      log.error('store.signal_failed', { signalId: s.id, ...errFields(e) });
    }
  }

  async saveOutcome(p: PaperPosition): Promise<void> {
    try {
      await pool.query(
        `insert into signal_outcomes (
           signal_id, filled_at, resolved_ts, result, exit_px,
           mfe_points, mae_points, r_gross, r_net,
           pnl_net_usdt_per_btc, fees_usdt_per_btc
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (signal_id) do update set
           filled_at = excluded.filled_at,
           resolved_ts = excluded.resolved_ts,
           result = excluded.result,
           exit_px = excluded.exit_px,
           mfe_points = excluded.mfe_points,
           mae_points = excluded.mae_points,
           r_gross = excluded.r_gross,
           r_net = excluded.r_net,
           pnl_net_usdt_per_btc = excluded.pnl_net_usdt_per_btc,
           fees_usdt_per_btc = excluded.fees_usdt_per_btc`,
        [
          p.signal.id, p.filledAt, p.closedAt, p.outcome,
          p.exitCents === null ? null : (Number(p.exitCents) / 100).toFixed(2),
          p.mfePoints.toFixed(2), p.maePoints.toFixed(2),
          p.rGross === null ? null : p.rGross.toFixed(4),
          p.rNet === null ? null : p.rNet.toFixed(4),
          p.pnlNetUsdtPerBtc === null ? null : p.pnlNetUsdtPerBtc.toFixed(2),
          p.feesUsdtPerBtc === null ? null : p.feesUsdtPerBtc.toFixed(2),
        ],
      );
    } catch (e) {
      log.error('store.outcome_failed', { signalId: p.signal.id, ...errFields(e) });
    }
  }

  async saveStats(stats: readonly BucketStats[]): Promise<void> {
    if (stats.length === 0) return;
    try {
      for (const s of stats) {
        await pool.query(
          `insert into setup_stats (
             setup, regime, hour_bucket, window_n, wins, win_rate,
             exp_r_net, exp_r_gross, nofill_rate, enabled, updated_at
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
           on conflict (setup, regime, hour_bucket) do update set
             window_n = excluded.window_n, wins = excluded.wins,
             win_rate = excluded.win_rate, exp_r_net = excluded.exp_r_net,
             exp_r_gross = excluded.exp_r_gross, nofill_rate = excluded.nofill_rate,
             enabled = excluded.enabled, updated_at = now()`,
          [
            s.setup, s.regime, s.hourBucket, s.n, s.wins,
            s.winRate.toFixed(4), s.expRNet.toFixed(4), s.expRGross.toFixed(4),
            s.nofillRate.toFixed(4), s.enabled,
          ],
        );
      }
    } catch (e) {
      log.warn('store.stats_failed', errFields(e));
    }
  }

  async saveStreamHealth(workerId: string, statuses: readonly StreamStatus[]): Promise<void> {
    try {
      for (const s of statuses) {
        await pool.query(
          `insert into ops_stream_health
             (worker_id, stream, total_msgs, last_window, expected_per_min, silent, critical)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [workerId, s.name, s.total, s.lastWindow, s.expectedPerMin, s.silent, s.critical],
        );
      }
    } catch (e) {
      log.warn('store.stream_health_failed', errFields(e));
    }
  }

  /**
   * Dung lai lich su ATR(5m) tu bar da luu.
   *
   * Lich su nay chi nam trong RAM, nen moi lan worker khoi dong lai — deploy, crash,
   * Fly doi may — bo loc che do ve lai "CHUA_DU_DU_LIEU" va he thong cam 6 gio.
   * Trong mot lan chay 72 gio thi do la rat nhieu thoi gian chet, va te hon la
   * thoi gian chet KHONG hien ra nhu mot loi: log van xanh, chi la khong co signal nao.
   *
   * Cong thuc phai khop voi FeatureEngine.#atr5mPct: gop bar 1 giay thanh nen 5 phut,
   * true range moi nen, roi trung binh 14 nen gan nhat, quy ve % gia.
   */
  async loadAtrHistory(lookbackDays: number): Promise<{ ts: number; atrPct: number }[]> {
    try {
      const r = await pool.query<{ ts: string; atr_pct: string }>(
        `with c as (
           select to_timestamp(floor(extract(epoch from bar_ts) / 300) * 300) as t5,
                  max(high) as h, min(low) as l,
                  (array_agg(close order by bar_ts desc))[1] as c
           from market.bars_1s
           where bar_ts > now() - ($1 || ' days')::interval
             and high is not null and low is not null and close is not null
           group by 1
         ),
         tr as (
           select t5, c,
                  greatest(
                    h - l,
                    abs(h - lag(c) over (order by t5)),
                    abs(l - lag(c) over (order by t5))
                  ) as tr
           from c
         ),
         a as (
           select t5, c,
                  avg(tr) over (order by t5 rows between 13 preceding and current row) as atr14
           from tr
         )
         select (extract(epoch from t5) * 1000)::bigint::text as ts,
                (atr14 / c * 100)::text as atr_pct
         from a
         where atr14 is not null and c > 0
         order by t5`,
        [lookbackDays],
      );
      return r.rows
        .map((x) => ({ ts: Number(x.ts), atrPct: Number(x.atr_pct) }))
        .filter((x) => Number.isFinite(x.ts) && Number.isFinite(x.atrPct));
    } catch (e) {
      log.warn('store.atr_history_failed', errFields(e));
      return [];
    }
  }

  /** Nap lai trang thai cong loc khi worker khoi dong — tri nho phai song qua restart. */
  async loadGateState(): Promise<
    { setup: string; regime: string; hour_bucket: number; enabled: boolean }[]
  > {
    try {
      const r = await pool.query<{ setup: string; regime: string; hour_bucket: number; enabled: boolean }>(
        'select setup, regime, hour_bucket, enabled from setup_stats',
      );
      return r.rows;
    } catch (e) {
      log.warn('store.gate_load_failed', errFields(e));
      return [];
    }
  }
}
