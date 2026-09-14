/**
 * Giam sat TUNG stream, khong chi cap socket.
 *
 * Bai hoc tu thuc te: `wss://fstream.binance.com` co the nhan subscribe cho
 * @aggTrade / @kline_1m / @forceOrder / @markPrice roi khong bao gio gui gi, trong khi
 * @trade va @bookTicker tren cung ket noi chay binh thuong. Socket van "OPEN", ping/pong
 * van chay, uptime cap ket noi van 100%.
 *
 * Neu worker chi do uptime cap socket, no se bao "chay 72h khong su co" trong khi
 * bars_1s day nhung dong co trades = 0. Do la kieu mat du lieu te nhat: im lang.
 */

import { STREAMS, WS, type StreamSpec } from '../config/index.js';
import { log } from '../lib/logger.js';

export interface StreamStatus {
  readonly name: string;
  readonly role: string;
  readonly critical: boolean;
  /** Tong message ke tu khi worker chay. */
  readonly total: number;
  /** Message trong cua so danh gia gan nhat. */
  readonly lastWindow: number;
  readonly expectedPerMin: number;
  /** Chua nhan duoc message nao ke tu luc khoi dong. */
  readonly neverSeen: boolean;
  readonly silent: boolean;
  readonly lastSeenAt: string | null;
}

export class StreamHealth {
  #total = new Map<string, number>();
  #window = new Map<string, number>();
  #lastSeen = new Map<string, number>();
  #lastWindowCount = new Map<string, number>();
  #timer: NodeJS.Timeout | null = null;
  #startedAt = Date.now();

  constructor(private readonly specs: readonly StreamSpec[] = STREAMS) {
    for (const s of specs) {
      this.#total.set(s.name, 0);
      this.#window.set(s.name, 0);
      this.#lastWindowCount.set(s.name, 0);
    }
  }

  start(): void {
    this.#timer = setInterval(() => this.#rollWindow(), WS.healthWindowMs);
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** Goi moi khi co message tren mot stream. */
  mark(streamName: string): void {
    this.#total.set(streamName, (this.#total.get(streamName) ?? 0) + 1);
    this.#window.set(streamName, (this.#window.get(streamName) ?? 0) + 1);
    this.#lastSeen.set(streamName, Date.now());
  }

  #rollWindow(): void {
    for (const s of this.specs) {
      this.#lastWindowCount.set(s.name, this.#window.get(s.name) ?? 0);
      this.#window.set(s.name, 0);
    }
    const dead = this.statuses().filter((s) => s.silent);
    for (const d of dead) {
      log.warn('stream.silent', {
        stream: d.name,
        role: d.role,
        critical: d.critical,
        expectedPerMin: d.expectedPerMin,
        gotLastMin: d.lastWindow,
        neverSeen: d.neverSeen,
      });
    }
  }

  statuses(): readonly StreamStatus[] {
    const ranFor = Date.now() - this.#startedAt;
    return this.specs.map((s) => {
      const total = this.#total.get(s.name) ?? 0;
      const lastWindow = this.#lastWindowCount.get(s.name) ?? 0;
      const seen = this.#lastSeen.get(s.name);
      const neverSeen = total === 0;
      // Chi ket luan im lang khi da chay du mot cua so, va stream co ky vong tan suat.
      const silent =
        s.minMsgPerMin > 0 &&
        ranFor >= WS.healthWindowMs &&
        lastWindow < s.minMsgPerMin;
      return {
        name: s.name,
        role: s.role,
        critical: s.critical,
        total,
        lastWindow,
        expectedPerMin: s.minMsgPerMin,
        neverSeen,
        silent,
        lastSeenAt: seen === undefined ? null : new Date(seen).toISOString(),
      };
    });
  }

  /** Co stream BAT BUOC nao dang chet khong — dung de bao "Tuan 1 chua the tinh la dat". */
  get criticalDown(): readonly StreamStatus[] {
    return this.statuses().filter((s) => s.critical && s.silent);
  }

  compact(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of this.statuses()) out[s.name.replace(/^[a-z]+@/, '')] = s.total;
    return out;
  }
}

/**
 * Probe luc khoi dong: mo ket noi thu, xem stream nao that su co du lieu.
 * Chay mot lan truoc khi vao vong chinh — de biet ngay tu dau minh dang thieu gi,
 * thay vi phat hien sau 72h rang cot liq_* toan bang 0.
 */
export async function probeStreams(
  baseUrl: string,
  specs: readonly StreamSpec[],
  durationMs: number,
): Promise<Map<string, number>> {
  const { default: WebSocketImpl } = await import('ws');
  const counts = new Map<string, number>(specs.map((s) => [s.name, 0]));
  const url = `${baseUrl}?streams=${specs.map((s) => s.name).join('/')}`;

  return new Promise((resolve) => {
    const ws = new WebSocketImpl(url);
    const done = (): void => {
      try { ws.close(); } catch { /* dang dong roi */ }
      resolve(counts);
    };
    ws.on('message', (raw) => {
      try {
        const p: unknown = JSON.parse(raw.toString());
        if (typeof p === 'object' && p !== null && 'stream' in p) {
          const name = (p as { stream: unknown }).stream;
          if (typeof name === 'string') counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      } catch { /* bo qua khung hong trong luc probe */ }
    });
    ws.on('error', () => done());
    setTimeout(done, durationMs);
  });
}
