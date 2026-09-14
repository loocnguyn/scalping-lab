-- ---------------------------------------------------------------------------
-- scalping-lab — signal, ket qua, thong ke setup, suc khoe stream
--
-- Muc 0 cua tang tu hoc: moi signal phat ra, KE CA signal bi cong loc chan, deu luu
-- kem toan bo anh chup feature va duoc theo doi toi khi cham TP hoac SL.
-- Khong co lop nay thi khong co gi de hoc.
-- ---------------------------------------------------------------------------

create table if not exists signals (
  id            uuid primary key,
  ts            timestamptz not null,
  available_at  timestamptz not null,
  setup         text not null check (setup in ('S1','S2','S3')),
  side          text not null check (side in ('LONG','SHORT')),
  entry_px      numeric(20,2) not null,
  stop_px       numeric(20,2) not null,
  target_px     numeric(20,2) not null,
  expires_at    timestamptz not null,
  stop_points   numeric(14,2) not null,
  target_points numeric(14,2) not null,
  r_multiple    numeric(10,3) not null,
  regime        text not null,
  gated         boolean not null,
  gate_reason   text,
  p_hat         numeric(6,4),   -- xac suat tu meta-model (Tuan 7-8)
  be_wr         numeric(6,4),   -- WR hoa von tai TP/SL nay
  features      jsonb not null, -- anh chup toan bo feature
  created_at    timestamptz not null default now(),

  -- Rang buoc cung #2, cuong che o tang thap nhat.
  -- TP 100 diem can win rate 88.7% de hoa von — de xuat nhu vay la sai, khong phai
  -- "tin hieu yeu". Chan o DB de khong code nao lach duoc.
  constraint signals_target_min check (target_points >= 250)
);

create index if not exists signals_ts_idx on signals (ts desc);
create index if not exists signals_setup_idx on signals (setup, regime);

create table if not exists signal_outcomes (
  signal_id     uuid primary key references signals(id) on delete cascade,
  filled_at     timestamptz,
  resolved_ts   timestamptz,
  result        text not null check (result in ('tp','sl','timeout','nofill')),
  exit_px       numeric(20,2),
  mfe_points    numeric(14,2) not null default 0,
  mae_points    numeric(14,2) not null default 0,
  r_gross       numeric(10,4),
  -- Cot quan trong nhat bang nay. Moi ket luan "co lai hay khong" doc tu day.
  r_net         numeric(10,4),
  pnl_net_usdt_per_btc numeric(16,2),
  fees_usdt_per_btc    numeric(16,2),
  created_at    timestamptz not null default now()
);

create index if not exists signal_outcomes_result_idx on signal_outcomes (result);

-- Trang thai cong thich nghi. Phai song qua restart cua worker.
create table if not exists setup_stats (
  setup       text not null,
  regime      text not null,
  hour_bucket int  not null,
  window_n    int  not null,
  wins        int  not null,
  win_rate    numeric(6,4) not null,
  exp_r_net   numeric(10,4) not null,
  exp_r_gross numeric(10,4) not null,
  nofill_rate numeric(6,4) not null,
  enabled     boolean not null,
  updated_at  timestamptz not null default now(),
  primary key (setup, regime, hour_bucket)
);

-- Lich su suc khoe tung stream — bang chung cho "stream nao that su co du lieu".
create table if not exists ops_stream_health (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  worker_id   text not null,
  stream      text not null,
  total_msgs  bigint not null,
  last_window bigint not null,
  expected_per_min int not null,
  silent      boolean not null,
  critical    boolean not null
);

create index if not exists ops_stream_health_at_idx on ops_stream_health (at desc);

-- Bang tong ket hieu qua. Chi tinh signal KHONG bi cong loc chan.
create or replace view v_performance as
select
  s.setup,
  s.regime,
  count(*) filter (where o.result <> 'nofill')                 as n_filled,
  count(*) filter (where o.result = 'nofill')                  as n_nofill,
  count(*) filter (where o.result = 'tp')                      as n_tp,
  count(*) filter (where o.result = 'sl')                      as n_sl,
  round(avg(o.r_net)   filter (where o.result <> 'nofill'), 4) as exp_r_net,
  round(avg(o.r_gross) filter (where o.result <> 'nofill'), 4) as exp_r_gross,
  round(sum(o.r_net)   filter (where o.result <> 'nofill'), 3) as total_r_net,
  round(avg(o.mfe_points), 1)                                  as avg_mfe,
  round(avg(o.mae_points), 1)                                  as avg_mae
from signals s
join signal_outcomes o on o.signal_id = s.id
where not s.gated
group by s.setup, s.regime;
