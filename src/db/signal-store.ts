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
           id, ts, available_at, setup, side, entry_px, stop_px, target_px, expires_at,
           stop_points, target_points, r_multiple, regime, gated, gate_reason, features
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         on conflict (id) do nothing`,
        [
          s.id, s.ts, s.features.availableAt, s.setup, s.side,
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
