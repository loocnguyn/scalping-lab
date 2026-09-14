/**
 * WebSocket thuong tru co tu reconnect.
 *
 * CLAUDE.md / Quy uoc code: "Worker phai tu reconnect WebSocket co exponential backoff,
 * va ghi log moi lan mat ket noi kem khoang thoi gian mat — chi so uptime la tieu chi
 * qua Cua 1."
 *
 * Ba co che giu ket noi song:
 *  1. Reconnect co backoff mu + jitter khi dut.
 *  2. Phat hien "ket noi thay" — con mo nhung khong co message nao trong stalenessTimeoutMs.
 *     bookTicker chay vai chuc message/giay nen im lang 30s gan nhu chac chan la hong.
 *  3. Chu dong xoay ket noi truoc moc 24h Binance tu dong dong.
 */

import WebSocket from 'ws';
import { WS } from '../config/index.js';
import { log, errFields } from '../lib/logger.js';

export interface ConnectionEvent {
  readonly kind: 'up' | 'down';
  readonly at: Date;
  /** Chi co o 'up': da mat ket noi bao lau truoc do (ms). */
  readonly downtimeMs?: number;
  readonly reason?: string;
}

export type MessageHandler = (stream: string, data: unknown) => void;
export type ConnectionListener = (ev: ConnectionEvent) => void;

export class ReconnectingStream {
  #ws: WebSocket | null = null;
  #attempt = 0;
  #stopped = false;
  #lastMessageAt = 0;
  #downSince: number | null = Date.now();
  #stalenessTimer: NodeJS.Timeout | null = null;
  #cycleTimer: NodeJS.Timeout | null = null;
  #reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly streams: readonly string[],
    private readonly onMessage: MessageHandler,
    private readonly onConnectionChange: ConnectionListener,
  ) {}

  start(): void {
    this.#stopped = false;
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    this.#clearTimers();
    this.#ws?.close(1000, 'shutdown');
    this.#ws = null;
  }

  get connected(): boolean {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  #url(): string {
    return `${WS.baseUrl}?streams=${this.streams.join('/')}`;
  }

  #connect(): void {
    if (this.#stopped) return;

    const url = this.#url();
    log.info('ws.connecting', { attempt: this.#attempt, streams: this.streams.length });

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      log.error('ws.construct_failed', errFields(e));
      this.#scheduleReconnect('construct_failed');
      return;
    }
    this.#ws = ws;

    ws.on('open', () => {
      const downtimeMs = this.#downSince === null ? 0 : Date.now() - this.#downSince;
      this.#downSince = null;
      this.#attempt = 0;
      this.#lastMessageAt = Date.now();
      log.info('ws.open', { downtimeMs, downtimeSec: Math.round(downtimeMs / 100) / 10 });
      this.onConnectionChange({ kind: 'up', at: new Date(), downtimeMs });
      this.#armStaleness();
      this.#armProactiveCycle();
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      this.#lastMessageAt = Date.now();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch (e) {
        log.warn('ws.bad_json', errFields(e));
        return;
      }
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'stream' in parsed &&
        'data' in parsed
      ) {
        const env = parsed as { stream: unknown; data: unknown };
        if (typeof env.stream === 'string') this.onMessage(env.stream, env.data);
      }
    });

    // Binance gui ping moi 3 phut; `ws` tu tra pong. Ta chi ghi nhan de biet con song.
    ws.on('ping', () => {
      this.#lastMessageAt = Date.now();
    });

    ws.on('close', (code: number, reasonBuf: Buffer) => {
      const reason = reasonBuf.toString() || `code=${code}`;
      this.#markDown(reason);
      this.#scheduleReconnect(reason);
    });

    ws.on('error', (e: Error) => {
      log.warn('ws.error', errFields(e));
      // 'close' se den ngay sau; khong reconnect o day de tranh nhan doi.
    });
  }

  #markDown(reason: string): void {
    if (this.#downSince !== null) return; // da ghi nhan roi
    this.#downSince = Date.now();
    this.#clearTimers();
    log.warn('ws.down', { reason });
    this.onConnectionChange({ kind: 'down', at: new Date(), reason });
  }

  #scheduleReconnect(reason: string): void {
    if (this.#stopped) return;
    if (this.#reconnectTimer !== null) return;

    const { baseDelayMs, maxDelayMs, jitterRatio } = WS.reconnect;
    const exp = Math.min(baseDelayMs * 2 ** this.#attempt, maxDelayMs);
    const jitter = exp * jitterRatio * (Math.random() * 2 - 1);
    const delay = Math.max(250, Math.round(exp + jitter));
    this.#attempt += 1;

    log.info('ws.reconnect_scheduled', { delayMs: delay, attempt: this.#attempt, reason });
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, delay);
  }

  /** Con mo nhung im lang qua lau = coi nhu chet, ep dong de kich hoat reconnect. */
  #armStaleness(): void {
    this.#stalenessTimer = setInterval(() => {
      const silentMs = Date.now() - this.#lastMessageAt;
      if (silentMs > WS.stalenessTimeoutMs) {
        log.warn('ws.stale', { silentMs });
        this.#markDown('stale');
        this.#ws?.terminate();
        this.#scheduleReconnect('stale');
      }
    }, Math.max(1_000, Math.floor(WS.stalenessTimeoutMs / 3)));
  }

  /** Binance dong ket noi sau 24h — ta tu xoay truoc de kiem soat duoc thoi diem. */
  #armProactiveCycle(): void {
    this.#cycleTimer = setTimeout(() => {
      log.info('ws.proactive_cycle');
      this.#ws?.close(1000, 'proactive_cycle');
    }, WS.proactiveCycleMs);
  }

  #clearTimers(): void {
    if (this.#stalenessTimer !== null) clearInterval(this.#stalenessTimer);
    if (this.#cycleTimer !== null) clearTimeout(this.#cycleTimer);
    this.#stalenessTimer = null;
    this.#cycleTimer = null;
  }
}
