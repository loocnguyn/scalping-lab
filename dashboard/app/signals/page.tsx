import { ErrBox, WorkerNotRunning } from '../../components/Empty';
import { safeQuery, supabase } from '../../lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Row {
  id: string;
  ts: string;
  setup: string;
  side: string;
  entry_px: string;
  stop_px: string;
  target_px: string;
  stop_points: string;
  target_points: string;
  r_multiple: string;
  regime: string;
  gated: boolean;
  gate_reason: string | null;
  signal_outcomes: {
    result: string;
    exit_px: string | null;
    r_net: string | null;
    r_gross: string | null;
    mfe_points: string;
    mae_points: string;
    fees_usdt_per_btc: string | null;
  }[] | null;
}

function n(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export default async function SignalsPage() {
  const { rows, error } = await safeQuery<Row>(() =>
    supabase
      .from('signals')
      .select(
        'id,ts,setup,side,entry_px,stop_px,target_px,stop_points,target_points,r_multiple,' +
        'regime,gated,gate_reason,signal_outcomes(result,exit_px,r_net,r_gross,mfe_points,mae_points,fees_usdt_per_btc)',
      )
      .order('ts', { ascending: false })
      .limit(200),
  );

  return (
    <>
      <h1>Nhật ký signal</h1>
      <p className="sub">
        Mọi signal đã phát, <strong>kể cả signal bị cổng lọc chặn</strong>. Signal bị chặn vẫn
        được theo dõi tới khi chạm TP hoặc SL — không có dữ liệu về chúng thì không bao giờ
        biết cổng lọc chặn đúng hay chặn nhầm.
      </p>

      {error !== null && <ErrBox msg={error} />}
      {error === null && rows.length === 0 && <WorkerNotRunning />}

      {rows.length > 0 && (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>Setup</th>
                <th>Hướng</th>
                <th className="num">Entry</th>
                <th className="num">Stop</th>
                <th className="num">Target</th>
                <th className="num">SL (điểm)</th>
                <th className="num">TP (điểm)</th>
                <th className="num">R</th>
                <th>Chế độ</th>
                <th>Kết quả</th>
                <th className="num">R ròng</th>
                <th className="num">R gộp</th>
                <th className="num">MFE</th>
                <th className="num">MAE</th>
                <th>Cổng lọc</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const out = r.signal_outcomes?.[0];
                const rn = n(out?.r_net ?? null);
                return (
                  <tr key={r.id}>
                    <td className="muted mono">{new Date(r.ts).toLocaleString('vi-VN')}</td>
                    <td className="mono">{r.setup}</td>
                    <td><span className={`tag ${r.side.toLowerCase()}`}>{r.side}</span></td>
                    <td className="num">{n(r.entry_px)?.toFixed(1)}</td>
                    <td className="num">{n(r.stop_px)?.toFixed(1)}</td>
                    <td className="num">{n(r.target_px)?.toFixed(1)}</td>
                    <td className="num">{n(r.stop_points)?.toFixed(0)}</td>
                    <td className="num">{n(r.target_points)?.toFixed(0)}</td>
                    <td className="num">{n(r.r_multiple)?.toFixed(2)}</td>
                    <td className="muted">{r.regime}</td>
                    <td>
                      {out === undefined
                        ? <span className="muted">đang mở</span>
                        : <span className={`tag ${out.result}`}>{out.result.toUpperCase()}</span>}
                    </td>
                    <td className={`num ${rn === null ? 'muted' : rn > 0 ? 'up' : 'down'}`}>
                      {rn === null ? '—' : `${rn > 0 ? '+' : ''}${rn.toFixed(3)}`}
                    </td>
                    <td className="num muted">
                      {n(out?.r_gross ?? null)?.toFixed(3) ?? '—'}
                    </td>
                    <td className="num muted">{n(out?.mfe_points ?? null)?.toFixed(0) ?? '—'}</td>
                    <td className="num muted">{n(out?.mae_points ?? null)?.toFixed(0) ?? '—'}</td>
                    <td>
                      {r.gated
                        ? <span className="tag off" title={r.gate_reason ?? ''}>BỊ CHẶN</span>
                        : <span className="tag on">QUA</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p className="sub" style={{ marginTop: 14 }}>
          <strong>R ròng</strong> là cột duy nhất đáng tin để kết luận lãi/lỗ — nó đã trừ phí.
          R gộp luôn đẹp hơn và luôn sai.
        </p>
      )}
    </>
  );
}
