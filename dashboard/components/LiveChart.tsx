'use client';

import { useEffect, useRef, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';

/**
 * Chart live noi THANG toi Binance tu trinh duyet.
 *
 * Vi sao khong doc bar tu DB: trang nay phai dung duoc ngay ca khi worker chua chay.
 * Doc DB thi khi bang rong se ra mot man hinh trong khong giai thich duoc gi. Noi
 * thang Binance thi luon co gia va spread that de nhin.
 *
 * Dung dung nhung stream ma worker dung — @trade va @bookTicker. Hai cai nay da duoc
 * kiem chung la con phat; @aggTrade va @kline_* tren endpoint futures dang im lang
 * (xem README muc "Trang thai stream").
 */

const WS_URL = 'wss://fstream.binance.com/stream?streams=btcusdt@trade/btcusdt@bookTicker';

interface Candle {
  time: UTCTimestamp;
  open: number; high: number; low: number; close: number;
}

export default function LiveChart() {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const currentRef = useRef<Candle | null>(null);
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

    const chart = createChart(boxRef.current, {
      height: 380,
      layout: { background: { color: 'transparent' }, textColor: '#787b86', fontSize: 11 },
      grid: {
        vertLines: { color: 'rgba(36,42,56,.6)' },
        horzLines: { color: 'rgba(36,42,56,.6)' },
      },
      rightPriceScale: { borderColor: '#242a38' },
      timeScale: { borderColor: '#242a38', timeVisible: true, secondsVisible: true },
      crosshair: { mode: 0 },
    });
    const series = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const onResize = (): void => {
      if (boxRef.current !== null) chart.applyOptions({ width: boxRef.current.clientWidth });
    };
    onResize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // --- Noi WebSocket, tu ket noi lai khi rot ---
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let closed = false;

    const connect = (): void => {
      if (closed) return;
      ws = new WebSocket(WS_URL);

      ws.onopen = () => { attempt = 0; setLive(true); };

      ws.onmessage = (ev: MessageEvent<string>) => {
        let msg: { stream?: string; data?: unknown };
        try { msg = JSON.parse(ev.data) as typeof msg; } catch { return; }
        const d = msg.data;
        if (typeof d !== 'object' || d === null) return;
        const o = d as Record<string, unknown>;

        if (msg.stream?.endsWith('@trade') === true) {
          const p = Number(o['p']);
          const q = Number(o['q']);
          const t = Number(o['T']);
          if (!Number.isFinite(p) || !Number.isFinite(t)) return;

          // m = true nghia la ben mua la maker => nguoi BAN chu dong.
          cvdRef.current += o['m'] === true ? -q : q;

          setPrice((old) => { setPrev(old); return p; });
          setTrades((n) => n + 1);

          const sec = Math.floor(t / 1000) as UTCTimestamp;
          const cur = currentRef.current;
          if (cur === null || cur.time !== sec) {
            if (cur !== null) seriesRef.current?.update(cur);
            currentRef.current = { time: sec, open: p, high: p, low: p, close: p };
          } else {
            cur.high = Math.max(cur.high, p);
            cur.low = Math.min(cur.low, p);
            cur.close = p;
          }
          if (currentRef.current !== null) seriesRef.current?.update(currentRef.current);
        } else if (msg.stream?.endsWith('@bookTicker') === true) {
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
    const cvdTimer = setInterval(() => { setCvd(cvdRef.current); }, 500);

    return () => {
      closed = true;
      if (retry !== null) clearTimeout(retry);
      clearInterval(cvdTimer);
      ws?.close();
    };
  }, []);

  const dir = price !== null && prev !== null ? (price > prev ? 'up' : price < prev ? 'down' : '') : '';

  return (
    <div className="chartbox">
      <div className="head">
        <div className={`price ${dir}`}>
          {price === null ? '—' : price.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
        </div>
        <div className="muted">BTCUSDT perp</div>
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
        </div>
        <div className="muted mono">{trades.toLocaleString('en-US')} lệnh</div>
      </div>
      <div ref={boxRef} />
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Nến 1 giây dựng trực tiếp trong trình duyệt từ <code>btcusdt@trade</code>. CVD tính từ
        lúc mở trang, không phải từ dữ liệu đã lưu.
      </div>
    </div>
  );
}
