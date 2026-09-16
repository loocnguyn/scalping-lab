'use client';

import { useEffect, useRef, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';

/**
 * Chart live noi THANG toi Binance tu trinh duyet.
 *
 * Vi sao khong doc bar tu DB: trang nay phai dung duoc ngay ca khi worker chua chay.
 * Doc DB thi khi bang rong se ra man hinh trong khong giai thich duoc gi.
 *
 * Dung dung nhung stream ma worker dung — @trade va @bookTicker. Hai cai nay da duoc
 * kiem chung la con phat tren CA HAI hop dong; @aggTrade va @kline_* tren endpoint
 * futures dang im lang (xem README muc "Trang thai stream").
 */

interface Market {
  readonly symbol: string;
  readonly label: string;
  readonly stream: string;
  /** So chu so thap phan khi hien gia. BTC ~78.000 can 1; vang ~4.345 can 2. */
  readonly dp: number;
  readonly unit: string;
}

const MARKETS: readonly Market[] = [
  { symbol: 'BTCUSDT', label: '₿ Bitcoin', stream: 'btcusdt', dp: 1, unit: 'BTC' },
  { symbol: 'XAUUSDT', label: '🥇 Vàng', stream: 'xauusdt', dp: 2, unit: 'XAU' },
];

interface Candle {
  time: UTCTimestamp;
  open: number; high: number; low: number; close: number;
}

export default function LiveChart() {
  const [market, setMarket] = useState<Market>(MARKETS[0] as Market);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const curRef = useRef<Candle | null>(null);
  const cvdRef = useRef(0);

  const [price, setPrice] = useState<number | null>(null);
  const [prev, setPrev] = useState<number | null>(null);
  const [spread, setSpread] = useState<number | null>(null);
  const [cvd, setCvd] = useState(0);
  const [trades, setTrades] = useState(0);
  const [live, setLive] = useState(false);

  // --- Dung chart mot lan ---
  useEffect(() => {
    if (boxRef.current === null) return;
    const chart: IChartApi = createChart(boxRef.current, {
      height: 380,
      layout: { background: { color: 'transparent' }, textColor: '#787b86', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(36,42,56,.6)' }, horzLines: { color: 'rgba(36,42,56,.6)' } },
      rightPriceScale: { borderColor: '#242a38' },
      timeScale: { borderColor: '#242a38', timeVisible: true, secondsVisible: true },
    });
    seriesRef.current = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350', borderUpColor: '#26a69a',
      borderDownColor: '#ef5350', wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });
    const onResize = (): void => {
      if (boxRef.current !== null) chart.applyOptions({ width: boxRef.current.clientWidth });
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.remove();
      seriesRef.current = null;
    };
  }, []);

  // --- Noi WebSocket. Chay lai khi doi hop dong. ---
  useEffect(() => {
    // Doi hop dong thi moi so lieu deu phai reset — giu lai se tron du lieu hai thi truong.
    seriesRef.current?.setData([]);
    curRef.current = null;
    cvdRef.current = 0;
    setPrice(null); setPrev(null); setSpread(null); setCvd(0); setTrades(0); setLive(false);

    const url = `wss://fstream.binance.com/stream?streams=${market.stream}@trade/${market.stream}@bookTicker`;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let closed = false;

    const connect = (): void => {
      if (closed) return;
      ws = new WebSocket(url);
      ws.onopen = () => { attempt = 0; setLive(true); };
      ws.onmessage = (ev: MessageEvent<string>) => {
        let msg: { stream?: string; data?: unknown };
        try { msg = JSON.parse(ev.data) as typeof msg; } catch { return; }
        const d = msg.data;
        if (typeof d !== 'object' || d === null) return;
        const o = d as Record<string, unknown>;
        const s = msg.stream ?? '';

        if (s.endsWith('@trade')) {
          const p = Number(o['p']);
          const q = Number(o['q']);
          const t = Number(o['T']);
          if (!Number.isFinite(p) || !Number.isFinite(t)) return;
          // m = true: ben mua la maker => nguoi BAN chu dong.
          cvdRef.current += o['m'] === true ? -q : q;
          setPrice((old) => { setPrev(old); return p; });
          setTrades((n) => n + 1);

          const sec = Math.floor(t / 1000) as UTCTimestamp;
          const cur = curRef.current;
          if (cur === null || cur.time !== sec) {
            curRef.current = { time: sec, open: p, high: p, low: p, close: p };
          } else {
            cur.high = Math.max(cur.high, p);
            cur.low = Math.min(cur.low, p);
            cur.close = p;
          }
          if (curRef.current !== null) seriesRef.current?.update(curRef.current);
        } else if (s.endsWith('@bookTicker')) {
          const b = Number(o['b']);
          const a = Number(o['a']);
          if (Number.isFinite(b) && Number.isFinite(a) && b + a > 0) {
            setSpread(((a - b) / ((a + b) / 2)) * 10_000);
          }
        }
      };
      const reconnect = (): void => {
        setLive(false);
        if (closed) return;
        // Backoff mu co tran, giong worker.
        const delay = Math.min(1000 * 2 ** attempt, 30_000);
        attempt += 1;
        retry = setTimeout(connect, delay);
      };
      ws.onclose = reconnect;
      ws.onerror = () => { ws?.close(); };
    };

    connect();
    const timer = setInterval(() => { setCvd(cvdRef.current); }, 500);
    return () => {
      closed = true;
      if (retry !== null) clearTimeout(retry);
      clearInterval(timer);
      ws?.close();
    };
  }, [market]);

  const dir = price !== null && prev !== null ? (price > prev ? 'up' : price < prev ? 'down' : '') : '';

  return (
    <div className="chartbox">
      <div className="switcher">
        {MARKETS.map((m) => (
          <button
            key={m.symbol}
            type="button"
            onClick={() => { setMarket(m); }}
            className={m.symbol === market.symbol ? 'on' : ''}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="head">
        <div className={`price ${dir}`}>
          {price === null
            ? '—'
            : price.toLocaleString('en-US', { minimumFractionDigits: market.dp, maximumFractionDigits: market.dp })}
        </div>
        <div className="muted">{market.symbol} perp</div>
        <div className="muted">
          <span className={`dot ${live ? 'live' : 'dead'}`} />
          {live ? 'đang nhận' : 'mất kết nối'}
        </div>
        <div className="muted mono">spread {spread === null ? '—' : spread.toFixed(4)} bps</div>
        <div className="mono">
          <span className="muted">CVD </span>
          <span className={cvd > 0 ? 'up' : cvd < 0 ? 'down' : 'muted'}>
            {cvd > 0 ? '+' : ''}{cvd.toFixed(3)}
          </span>
          <span className="muted"> {market.unit}</span>
        </div>
        <div className="muted mono">{trades.toLocaleString('en-US')} lệnh</div>
      </div>

      <div ref={boxRef} />

      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Nến 1 giây dựng trực tiếp trong trình duyệt từ <code>{market.stream}@trade</code>.
        CVD tính từ lúc mở trang, không phải từ dữ liệu đã lưu. Đổi hợp đồng thì mọi số đếm
        reset — giữ lại sẽ trộn dữ liệu hai thị trường.
      </div>
    </div>
  );
}
