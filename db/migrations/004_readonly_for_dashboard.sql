-- ---------------------------------------------------------------------------
-- Quyen chi-doc cho dashboard tren Vercel.
--
-- Dashboard doc DB bang publishable key, va key do nam trong trinh duyet. Nguyen tac:
-- mo dung quyen SELECT, KHONG mo INSERT/UPDATE/DELETE. Worker ket noi truc tiep bang
-- role postgres nen khong chiu anh huong cua RLS.
--
-- DANH DOI DA Y THUC: ai co URL dashboard deu DOC duoc du lieu nay — bar BTC (von
-- cong khai) va ket qua paper trading. Khong co khoa, khong co thong tin tai khoan.
-- Ghi van bi chan tuyet doi, nen khong ai lam ban duoc chinh du lieu dung de ket luan
-- chien luoc lai hay lo. Da kiem tra: POST tra 401 "new row violates RLS policy".
-- ---------------------------------------------------------------------------

create policy "dashboard doc signals" on public.signals for select to anon using (true);
create policy "dashboard doc outcomes" on public.signal_outcomes for select to anon using (true);
create policy "dashboard doc setup_stats" on public.setup_stats for select to anon using (true);
create policy "dashboard doc stream_health" on public.ops_stream_health for select to anon using (true);
create policy "dashboard doc connection_events" on public.ops_connection_events for select to anon using (true);
create policy "dashboard doc ingest_stats" on public.ops_ingest_stats for select to anon using (true);

-- Schema `market` khong duoc PostgREST phoi bay. Mo view trong public de dashboard doc
-- duoc bar, kem quyen SELECT tren bang goc. security_invoker = on de view khong lach
-- quyen — va de advisor khong bao loi SECURITY DEFINER.
grant usage on schema market to anon;
grant select on market.bars_1s to anon;
grant select on market.liquidations to anon;

create or replace view public.v_bars_recent
  with (security_invoker = on) as
select bar_ts, available_at, open, high, low, close, vwap,
       volume, quote_volume, trades, taker_buy_vol, taker_sell_vol,
       bid_px, ask_px, spread_bps_avg, book_updates,
       liq_long_quote, liq_short_quote, liq_count
from market.bars_1s
where bar_ts > now() - interval '24 hours';

create or replace view public.v_liquidations_recent
  with (security_invoker = on) as
select event_ts, available_at, order_side, is_long_liq, price, qty, quote_value
from market.liquidations
where event_ts > now() - interval '24 hours';

-- Tong quan mot dong, de dashboard hoi duoc "he thong dang o dau" bang mot truy van.
create or replace view public.v_overview
  with (security_invoker = on) as
select
  (select count(*) from market.bars_1s)                            as bars_total,
  (select min(bar_ts) from market.bars_1s)                         as bars_from,
  (select max(bar_ts) from market.bars_1s)                         as bars_to,
  (select count(*) from market.liquidations)                       as liq_total,
  (select count(*) from signals)                                   as signals_total,
  (select count(*) from signals where not gated)                   as signals_active,
  (select count(*) from signal_outcomes where result <> 'nofill')  as trades_closed,
  (select round(avg(r_net), 4) from signal_outcomes
     where result <> 'nofill')                                     as exp_r_net,
  (select round(sum(r_net), 3) from signal_outcomes
     where result <> 'nofill')                                     as total_r_net,
  (select count(*) from signal_outcomes where result = 'tp')       as n_tp,
  (select count(*) from signal_outcomes where result = 'sl')       as n_sl,
  (select count(*) from signal_outcomes where result = 'nofill')   as n_nofill;

grant select on public.v_bars_recent, public.v_liquidations_recent, public.v_overview to anon;
