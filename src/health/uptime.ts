/**
 * Theo doi do ben ket noi — tieu chi qua Cua 1 (muc 8): "he thong khong mat ket noi
 * qua 0.5% thoi gian". Khong do duoc thi khong qua cua duoc, nen phan nay la bat buoc
 * chu khong phai trang tri.
 */

import { pool } from '../db/pool.js';
import { GATE1 } from '../config/index.js';
import { log, errFields } from '../lib/logger.js';
import type { ConnectionEvent } from '../ws/client.js';

export class UptimeTracker {
  readonly startedAt = Date.now();
  #downtimeMs = 0;
  #reconnects = 0;
  #liquidationsSeen = 0;

  constructor(readonly workerId: string) {}

  get downtimeMs(): number { return this.#downtimeMs; }
  get reconnects(): number { return this.#reconnects; }
  get liquidationsSeen(): number { return this.#liquidationsSeen; }

  countLiquidation(): void { this.#liquidationsSeen += 1; }

  get elapsedMs(): number { return Date.now() - this.startedAt; }

  /** Ty le mat ket noi tinh tren toan bo thoi gian chay. */
  get downtimeRatio(): number {
    const e = this.elapsedMs;
    return e === 0 ? 0 : this.#downtimeMs / e;
  }

  get passesGate1(): boolean {
    return this.downtimeRatio <= GATE1.maxDowntimeRatio;
  }

  get continuousHours(): number {
    return this.elapsedMs / 3_600_000;
  }

  async record(ev: ConnectionEvent): Promise<void> {
    if (ev.kind === 'up' && ev.downtimeMs !== undefined) {
      this.#downtimeMs += ev.downtimeMs;
      if (ev.downtimeMs > 0) this.#reconnects += 1;
    }
    try {
      await pool.query(
        `insert into ops_connection_events (at, kind, downtime_ms, reason, worker_id)
         values ($1, $2, $3, $4, $5)`,
        [ev.at, ev.kind, ev.downtimeMs ?? null, ev.reason ?? null, this.workerId],
      );
    } catch (e) {
      // Mat mot dong log khong duoc phep lam chet worker.
      log.warn('uptime.record_failed', errFields(e));
    }
  }

  /** Bao cao dinh ky — cung la noi de mat nhin thay Tuan 1 da chay duoc bao lau. */
  summary(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      workerId: this.workerId,
      uptimeHours: Math.round(this.continuousHours * 100) / 100,
      downtimeSec: Math.round(this.#downtimeMs / 1000),
      downtimePct: Math.round(this.downtimeRatio * 1_000_000) / 10_000,
      reconnects: this.#reconnects,
      passesGate1: this.passesGate1,
      gate1TargetHours: GATE1.requiredContinuousHours,
      ...extra,
    };
  }

  async persistStats(s: {
    barsEmitted: number; barsWritten: number; lateEvents: number;
    emptyBars: number; queueDepth: number;
  }): Promise<void> {
    try {
      await pool.query(
        `insert into ops_ingest_stats
           (worker_id, uptime_sec, downtime_sec, bars_emitted, bars_written,
            late_events, empty_bars, liquidations_seen, reconnects, queue_depth)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          this.workerId,
          Math.round(this.elapsedMs / 1000),
          Math.round(this.#downtimeMs / 1000),
          s.barsEmitted, s.barsWritten, s.lateEvents, s.emptyBars,
          this.#liquidationsSeen, this.#reconnects, s.queueDepth,
        ],
      );
    } catch (e) {
      log.warn('uptime.stats_failed', errFields(e));
    }
  }
}
