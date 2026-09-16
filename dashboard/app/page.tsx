import LiveChart from '../components/LiveChart';
import { ErrBox } from '../components/Empty';
import { safeQuery, supabase, type Overview } from '../lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function fmtInt(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString('en-US');
}

export default async function LivePage() {
  const { rows, error } = await safeQuery<Overview>(() =>
    supabase.from('v_overview').select('*').limit(1),
  );
  const o = rows[0];

  const expR = o?.exp_r_net ?? null;
  const closed = o?.trades_closed ?? 0;

  return (
    <>
      <h1>Live</h1>
      <p className="sub">
        Giá và dòng lệnh thời gian thực, nối thẳng Binance. Các con số tổng quan bên dưới
        đọc từ Supabase — tức là từ những gì worker đã thật sự ghi lại.
      </p>

      <LiveChart />

      {error !== null && <ErrBox msg={error} />}

      <h2>Worker đã thu được gì</h2>
      <div className="grid">
        <div className="card">
          <div className="label">Bar 1 giây</div>
          <div className="value">{fmtInt(o?.bars_total)}</div>
          <div className="note">
            {o?.bars_to == null ? 'chưa có bar nào' : `mới nhất ${new Date(o.bars_to).toLocaleString('vi-VN')}`}
          </div>
        </div>
        <div className="card">
          <div className="label">Thanh lý ghi được</div>
          <div className="value">{fmtInt(o?.liq_total)}</div>
          <div className="note warn">@forceOrder đang im lặng phía Binance</div>
        </div>
        <div className="card">
          <div className="label">Signal đã phát</div>
          <div className="value">{fmtInt(o?.signals_total)}</div>
          <div className="note">{fmtInt(o?.signals_active)} không bị cổng lọc chặn</div>
        </div>
        <div className="card">
          <div className="label">Lệnh paper đã đóng</div>
          <div className="value">{fmtInt(closed)}</div>
          <div className="note">
            {fmtInt(o?.n_tp)} TP · {fmtInt(o?.n_sl)} SL · {fmtInt(o?.n_nofill)} không khớp
          </div>
        </div>
        <div className="card">
          <div className="label">Expectancy ròng</div>
          <div className={`value ${expR === null ? 'muted' : expR > 0 ? 'up' : 'down'}`}>
            {expR === null ? '—' : `${expR > 0 ? '+' : ''}${Number(expR).toFixed(3)}R`}
          </div>
          <div className="note">
            {closed < 200 ? `cần 200 lệnh mới kết luận (${closed}/200)` : 'sau phí'}
          </div>
        </div>
        <div className="card">
          <div className="label">Tổng R ròng</div>
          <div className={`value ${(o?.total_r_net ?? 0) > 0 ? 'up' : (o?.total_r_net ?? 0) < 0 ? 'down' : 'muted'}`}>
            {o?.total_r_net == null ? '—' : Number(o.total_r_net).toFixed(2)}
          </div>
          <div className="note">cộng dồn, đã trừ phí</div>
        </div>
      </div>

      {closed < 200 && (
        <p className="sub" style={{ marginTop: 20 }}>
          <strong className="warn">Chưa kết luận được gì.</strong> Cửa 2 trong kế hoạch đòi tối thiểu
          200 lệnh có kết quả và expectancy ròng {'>'} +0.15R, và phải dương trên đa số đoạn
          walk-forward chứ không nhờ vài lệnh thắng đậm. Mọi con số trước mốc đó là nhiễu.
        </p>
      )}
    </>
  );
}
