import { ErrBox, Empty } from '../../components/Empty';
import { safeQuery, supabase, type Overview } from '../../lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface StreamRow {
  at: string; worker_id: string; stream: string;
  total_msgs: number; last_window: number; expected_per_min: number;
  silent: boolean; critical: boolean;
}
interface ConnRow {
  at: string; kind: string; downtime_ms: number | null; reason: string | null; worker_id: string;
}
interface IngestRow {
  at: string; worker_id: string; uptime_sec: number; downtime_sec: number;
  bars_emitted: number; bars_written: number; late_events: number;
  empty_bars: number; liquidations_seen: number; reconnects: number; queue_depth: number;
}

export default async function HealthPage() {
  const ov = await safeQuery<Overview>(() => supabase.from('v_overview').select('*').limit(1));
  const sh = await safeQuery<StreamRow>(() =>
    supabase.from('ops_stream_health').select('*').order('at', { ascending: false }).limit(20),
  );
  const ce = await safeQuery<ConnRow>(() =>
    supabase.from('ops_connection_events').select('*').order('at', { ascending: false }).limit(20),
  );
  const ig = await safeQuery<IngestRow>(() =>
    supabase.from('ops_ingest_stats').select('*').order('at', { ascending: false }).limit(1),
  );

  const err = ov.error ?? sh.error ?? ce.error ?? ig.error;
  const latest = ig.rows[0];

  // Chi giu ban ghi moi nhat cua tung stream.
  const seen = new Set<string>();
  const streams = sh.rows.filter((r) => {
    if (seen.has(r.stream)) return false;
    seen.add(r.stream);
    return true;
  });

  const uptimePct = latest === undefined || latest.uptime_sec === 0
    ? null
    : (1 - latest.downtime_sec / latest.uptime_sec) * 100;

  return (
    <>
      <h1>Sức khoẻ hệ thống</h1>
      <p className="sub">
        Tiêu chí Cửa 1: chạy 72 giờ liên tục, mất kết nối dưới 0.5% thời gian, mỗi setup tích
        được ít nhất 200 signal có kết quả.
      </p>

      {err !== null && <ErrBox msg={err} />}

      <div className="grid">
        <div className="card">
          <div className="label">Thời gian chạy liên tục</div>
          <div className="value">
            {latest === undefined ? '—' : `${(latest.uptime_sec / 3600).toFixed(1)}h`}
          </div>
          <div className="note">cần 72h</div>
        </div>
        <div className="card">
          <div className="label">Uptime</div>
          <div className={`value ${uptimePct === null ? 'muted' : uptimePct >= 99.5 ? 'up' : 'down'}`}>
            {uptimePct === null ? '—' : `${uptimePct.toFixed(3)}%`}
          </div>
          <div className="note">cần ≥ 99.5%</div>
        </div>
        <div className="card">
          <div className="label">Số lần mất kết nối</div>
          <div className="value">{latest?.reconnects ?? '—'}</div>
          <div className="note">{latest === undefined ? '' : `${latest.downtime_sec}s tổng`}</div>
        </div>
        <div className="card">
          <div className="label">Bar ghi / phát</div>
          <div className="value">
            {latest === undefined ? '—' : `${latest.bars_written}/${latest.bars_emitted}`}
          </div>
          <div className={`note ${latest !== undefined && latest.bars_written < latest.bars_emitted ? 'down' : ''}`}>
            {latest !== undefined && latest.bars_written < latest.bars_emitted
              ? 'đang mất bar' : 'không mất bar'}
          </div>
        </div>
        <div className="card">
          <div className="label">Event đến trễ</div>
          <div className={`value ${(latest?.late_events ?? 0) > 0 ? 'warn' : ''}`}>
            {latest?.late_events ?? '—'}
          </div>
          <div className="note">đến sau khi bar đã chốt</div>
        </div>
        <div className="card">
          <div className="label">Hàng đợi ghi DB</div>
          <div className={`value ${(latest?.queue_depth ?? 0) > 1000 ? 'down' : ''}`}>
            {latest?.queue_depth ?? '—'}
          </div>
          <div className="note">cao = DB đang chậm</div>
        </div>
      </div>

      <h2>Trạng thái từng stream</h2>
      <p className="sub" style={{ marginTop: -4 }}>
        Một WebSocket có thể <strong>mở mà vẫn không gửi gì</strong> trên một stream cụ thể.
        Nếu chỉ đo uptime ở cấp socket, worker sẽ báo &ldquo;72h không sự cố&rdquo; trong khi
        đang ghi bar rỗng. Bảng này là thứ phân biệt được hai trường hợp đó.
      </p>
      {streams.length === 0 ? (
        <Empty title="Chưa có bản ghi sức khoẻ stream">
          Worker ghi bảng này mỗi 60 giây khi đang chạy.
        </Empty>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Stream</th>
                <th className="num">Tổng msg</th>
                <th className="num">Phút gần nhất</th>
                <th className="num">Kỳ vọng/phút</th>
                <th>Bắt buộc</th>
                <th>Trạng thái</th>
                <th>Lúc</th>
              </tr>
            </thead>
            <tbody>
              {streams.map((r) => (
                <tr key={r.stream}>
                  <td className="mono">{r.stream}</td>
                  <td className="num">{r.total_msgs.toLocaleString('en-US')}</td>
                  <td className="num">{r.last_window.toLocaleString('en-US')}</td>
                  <td className="num muted">{r.expected_per_min === 0 ? '—' : r.expected_per_min}</td>
                  <td>{r.critical ? <span className="tag off">CÓ</span> : <span className="muted">không</span>}</td>
                  <td>
                    {r.silent
                      ? <span className="tag off">IM LẶNG</span>
                      : <span className="tag on">ĐANG CHẢY</span>}
                  </td>
                  <td className="muted mono">{new Date(r.at).toLocaleTimeString('vi-VN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Sự kiện kết nối gần đây</h2>
      {ce.rows.length === 0 ? (
        <Empty title="Chưa có sự kiện kết nối nào" />
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Lúc</th><th>Loại</th><th className="num">Mất bao lâu</th>
                <th>Lý do</th><th>Worker</th>
              </tr>
            </thead>
            <tbody>
              {ce.rows.map((r, i) => (
                <tr key={`${r.at}-${i}`}>
                  <td className="muted mono">{new Date(r.at).toLocaleString('vi-VN')}</td>
                  <td>
                    {r.kind === 'up'
                      ? <span className="tag on">LÊN</span>
                      : <span className="tag off">RỚT</span>}
                  </td>
                  <td className="num">
                    {r.downtime_ms === null ? '—' : `${(r.downtime_ms / 1000).toFixed(1)}s`}
                  </td>
                  <td className="muted">{r.reason ?? '—'}</td>
                  <td className="muted mono">{r.worker_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Dữ liệu đã lưu</h2>
      <div className="grid">
        <div className="card">
          <div className="label">Bar 1 giây</div>
          <div className="value">{(ov.rows[0]?.bars_total ?? 0).toLocaleString('en-US')}</div>
          <div className="note">
            {ov.rows[0]?.bars_from == null
              ? 'chưa có'
              : `từ ${new Date(ov.rows[0].bars_from).toLocaleString('vi-VN')}`}
          </div>
        </div>
        <div className="card">
          <div className="label">Thanh lý</div>
          <div className="value">{(ov.rows[0]?.liq_total ?? 0).toLocaleString('en-US')}</div>
          <div className="note warn">@forceOrder đang im lặng → S1 không kích hoạt được</div>
        </div>
      </div>
    </>
  );
}
