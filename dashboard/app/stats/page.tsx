import { ErrBox, WorkerNotRunning } from '../../components/Empty';
import { safeQuery, supabase, type Overview } from '../../lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface StatRow {
  setup: string;
  regime: string;
  hour_bucket: number;
  window_n: number;
  wins: number;
  win_rate: string;
  exp_r_net: string;
  exp_r_gross: string;
  nofill_rate: string;
  enabled: boolean;
  updated_at: string;
}

function n(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/** WR hoa von tai mot ty le TP/SL, da tinh phi. Cong thuc o muc 1 ke hoach. */
function breakevenWr(tpPoints: number, slPoints: number, feesUsdt: number): number {
  const win = tpPoints - feesUsdt;
  const loss = slPoints + feesUsdt;
  return (loss / (win + loss)) * 100;
}

export default async function StatsPage() {
  const ov = await safeQuery<Overview>(() => supabase.from('v_overview').select('*').limit(1));
  const st = await safeQuery<StatRow>(() =>
    supabase.from('setup_stats').select('*').order('window_n', { ascending: false }),
  );

  const o = ov.rows[0];
  const closed = o?.trades_closed ?? 0;
  const expR = n(o?.exp_r_net ?? null);
  const err = ov.error ?? st.error;

  // Doi chieu: voi TP250/SL100 vao-ra bang limit, phi khu hoi ~30.97 USDT/BTC.
  const beMaker = breakevenWr(250, 100, 30.97);
  const beMixed = breakevenWr(250, 100, 54.07); // vao maker, cat lo taker + truot

  return (
    <>
      <h1>Thống kê</h1>
      <p className="sub">
        Trang này trả lời đúng một câu hỏi: <strong>có thật sự sinh ra lợi nhuận sau phí không.</strong>
      </p>

      {err !== null && <ErrBox msg={err} />}

      <h2>Ngưỡng hoà vốn — con số phải vượt qua</h2>
      <div className="grid">
        <div className="card">
          <div className="label">WR hoà vốn (limit cả hai đầu)</div>
          <div className="value">{beMaker.toFixed(1)}%</div>
          <div className="note">TP 250 / SL 100, phí khứ hồi 30.97 USDT</div>
        </div>
        <div className="card">
          <div className="label">WR hoà vốn (thực tế)</div>
          <div className="value warn">{beMixed.toFixed(1)}%</div>
          <div className="note">vào maker, cắt lỗ taker + trượt 1 tick</div>
        </div>
        <div className="card">
          <div className="label">Mục tiêu Cửa 2</div>
          <div className="value">+0.15R</div>
          <div className="note">expectancy ròng, trên ≥ 200 mẫu</div>
        </div>
        <div className="card">
          <div className="label">Hiện tại</div>
          <div className={`value ${expR === null ? 'muted' : expR > 0.15 ? 'up' : expR > 0 ? 'warn' : 'down'}`}>
            {expR === null ? '—' : `${expR > 0 ? '+' : ''}${expR.toFixed(3)}R`}
          </div>
          <div className="note">{closed}/200 lệnh có kết quả</div>
        </div>
      </div>

      <h2>Kết luận</h2>
      <div className="card">
        {closed === 0 ? (
          <span className="muted">Chưa có lệnh paper nào đóng lại — chưa có gì để kết luận.</span>
        ) : closed < 200 ? (
          <>
            <span className="warn">Chưa đủ mẫu ({closed}/200).</span>{' '}
            <span className="muted">
              Mọi con số trước mốc này là nhiễu. Một chuỗi thắng 20 lệnh không nói lên điều gì
              khi kỳ vọng thật có thể âm.
            </span>
          </>
        ) : expR !== null && expR > 0.15 ? (
          <>
            <span className="up">Đạt ngưỡng Cửa 2 trên tập này.</span>{' '}
            <span className="muted">
              Vẫn cần kiểm định walk-forward trước khi tin: bỏ 5 lệnh lãi nhất ra thì
              expectancy còn dương không?
            </span>
          </>
        ) : expR !== null && expR > 0 ? (
          <><span className="warn">Dương nhưng dưới +0.15R</span>{' '}
            <span className="muted">— chưa đủ biên an toàn.</span></>
        ) : (
          <><span className="down">Expectancy ròng âm</span>{' '}
            <span className="muted">— chiến lược này đang lỗ tiền sau phí.</span></>
        )}
      </div>

      <h2>Theo setup × chế độ × khung giờ</h2>
      {st.rows.length === 0 ? (
        <WorkerNotRunning />
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Setup</th>
                <th>Chế độ</th>
                <th className="num">Giờ UTC</th>
                <th className="num">n</th>
                <th className="num">Thắng</th>
                <th className="num">WR</th>
                <th className="num">Exp R ròng</th>
                <th className="num">Exp R gộp</th>
                <th className="num">Không khớp</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {st.rows.map((r) => {
                const e = n(r.exp_r_net);
                return (
                  <tr key={`${r.setup}-${r.regime}-${r.hour_bucket}`}>
                    <td className="mono">{r.setup}</td>
                    <td className="muted">{r.regime}</td>
                    <td className="num">{String(r.hour_bucket).padStart(2, '0')}:00</td>
                    <td className="num">{r.window_n}</td>
                    <td className="num">{r.wins}</td>
                    <td className="num">{((n(r.win_rate) ?? 0) * 100).toFixed(0)}%</td>
                    <td className={`num ${e === null ? 'muted' : e > 0 ? 'up' : 'down'}`}>
                      {e === null ? '—' : `${e > 0 ? '+' : ''}${e.toFixed(3)}`}
                    </td>
                    <td className="num muted">{n(r.exp_r_gross)?.toFixed(3) ?? '—'}</td>
                    <td className="num muted">{((n(r.nofill_rate) ?? 0) * 100).toFixed(0)}%</td>
                    <td>
                      {r.enabled
                        ? <span className="tag on">ĐANG BẬT</span>
                        : <span className="tag off">TỰ TẮT</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="sub" style={{ marginTop: 14 }}>
        Setup nào có expectancy ròng âm trên ≥ 20 mẫu sẽ <strong>tự bị tắt</strong>, nhưng vẫn
        tiếp tục được ghi nhận ở chế độ shadow. Khi thống kê hồi phục thì tự bật lại.
        Tỉ lệ <strong>không khớp</strong> cao nghĩa là giá vào lệnh limit đang đặt sai chỗ —
        đó là thông tin, không phải lỗi.
      </p>
    </>
  );
}
