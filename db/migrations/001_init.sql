-- ---------------------------------------------------------------------------
-- scalping-lab — Tuan 1: luu tru bar 1 giay + thanh ly + do ben ket noi
--
-- Nguyen tac xuyen suot: moi bang du lieu thi truong deu co HAI moc thoi gian.
--   bar_ts / event_ts  — du lieu thuoc ve luc nao
--   available_at       — worker thuc su biet duoc luc nao
-- Feature engine (Tuan 2) va moi backtest PHAI loc theo available_at.
-- ---------------------------------------------------------------------------

create schema if not exists market;

-- --------------------------------------------------------------------------
-- Bar 1 giay
-- --------------------------------------------------------------------------
create table if not exists market.bars_1s (
  bar_ts          timestamptz  primary key,
  available_at    timestamptz  not null,

  -- OHLCV tu aggTrade. numeric, khong bao gio float.
  open            numeric(20, 2),
  high            numeric(20, 2),
  low             numeric(20, 2),
  close           numeric(20, 2),
  vwap            numeric(20, 2),
  volume          numeric(30, 8) not null default 0,
  quote_volume    numeric(30, 2) not null default 0,
  trades          integer        not null default 0,

  -- Phan tach taker: nguyen lieu cua CVD (feature cvd_60s o Tuan 2)
  taker_buy_vol   numeric(30, 8) not null default 0,
  taker_sell_vol  numeric(30, 8) not null default 0,

  -- Anh chup dinh so lenh cuoi giay
  bid_px          numeric(20, 2),
  bid_qty         numeric(30, 8),
  ask_px          numeric(20, 2),
  ask_qty         numeric(30, 8),
  spread_bps_avg  numeric(14, 4),
  book_updates    integer        not null default 0,

  -- Thanh ly gop theo giay (chi tiet nam o market.liquidations)
  liq_long_quote  numeric(30, 2) not null default 0,
  liq_short_quote numeric(30, 2) not null default 0,
  liq_count       integer        not null default 0,

  ingested_at     timestamptz    not null default now(),

  -- available_at khong bao gio duoc som hon bar_ts. Neu vi pham la logic sai,
  -- va sai kieu do se lam moi backtest phia sau dep gia tao.
  constraint bars_1s_available_after_bar check (available_at >= bar_ts)
);

create index if not exists bars_1s_available_at_idx
  on market.bars_1s using brin (available_at) with (pages_per_range = 32);

-- --------------------------------------------------------------------------
-- Thanh ly (raw). Nen cua setup S1.
-- --------------------------------------------------------------------------
create table if not exists market.liquidations (
  id            bigserial primary key,
  event_ts      timestamptz not null,
  available_at  timestamptz not null,
  symbol        text        not null,
  -- side cua LENH thanh ly: SELL => mot vi the LONG bi dong.
  order_side    text        not null check (order_side in ('BUY', 'SELL')),
  is_long_liq   boolean     not null,
  price         numeric(20, 2) not null,
  qty           numeric(30, 8) not null,
  quote_value   numeric(30, 2) not null,
  ingested_at   timestamptz not null default now()
);

create index if not exists liquidations_event_ts_idx on market.liquidations (event_ts desc);
create index if not exists liquidations_available_at_idx on market.liquidations (available_at desc);

-- --------------------------------------------------------------------------
-- Do ben ket noi — tieu chi qua Cua 1 (khong mat ket noi qua 0.5% thoi gian)
-- --------------------------------------------------------------------------
create table if not exists ops_connection_events (
  id           bigserial primary key,
  at           timestamptz not null,
  kind         text        not null check (kind in ('up', 'down')),
  downtime_ms  bigint,
  reason       text,
  worker_id    text        not null,
  created_at   timestamptz not null default now()
);

create index if not exists ops_connection_events_at_idx on ops_connection_events (at desc);

-- Anh chup suc khoe dinh ky, de tinh uptime va phat hien ro ri du lieu.
create table if not exists ops_ingest_stats (
  id                bigserial primary key,
  at                timestamptz not null default now(),
  worker_id         text        not null,
  uptime_sec        bigint      not null,
  downtime_sec      bigint      not null,
  bars_emitted      bigint      not null,
  bars_written      bigint      not null,
  late_events       bigint      not null,
  empty_bars        bigint      not null,
  liquidations_seen bigint      not null,
  reconnects        integer     not null,
  queue_depth       integer     not null
);

create index if not exists ops_ingest_stats_at_idx on ops_ingest_stats (at desc);

-- --------------------------------------------------------------------------
-- TimescaleDB neu co. Supabase hien KHONG bat timescaledb cho project moi —
-- khong co cung chay tot: 86.4k dong/ngay la rat nhe voi Postgres thuan,
-- index BRIN o tren da du. Khoi nay chi la bonus khi chay tren VPS tu dung.
-- --------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'timescaledb') then
    begin
      create extension if not exists timescaledb;
      perform create_hypertable('market.bars_1s', 'bar_ts',
                                chunk_time_interval => interval '1 day',
                                if_not_exists => true, migrate_data => true);
      raise notice 'timescaledb: da bat va chuyen bars_1s thanh hypertable';
    exception when others then
      raise notice 'timescaledb co san nhung khong bat duoc (%), dung Postgres thuan', sqlerrm;
    end;
  else
    raise notice 'timescaledb khong co san — dung Postgres thuan + BRIN index';
  end if;
end $$;

-- --------------------------------------------------------------------------
-- View tien dung: bao cao uptime cuon, doc thang de kiem tra Cua 1
-- --------------------------------------------------------------------------
create or replace view ops_uptime_24h as
with w as (
  select coalesce(sum(downtime_ms), 0)::numeric / 1000 as down_sec
  from ops_connection_events
  where kind = 'up' and at > now() - interval '24 hours'
)
select
  round(down_sec, 1)                                     as downtime_sec_24h,
  round(100 * (1 - down_sec / 86400), 4)                 as uptime_pct_24h,
  (down_sec / 86400) <= 0.005                            as passes_gate1
from w;
