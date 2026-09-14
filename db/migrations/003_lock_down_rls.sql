-- Worker ket noi truc tiep bang role `postgres` nen KHONG chiu anh huong cua RLS.
-- Bat RLS ma khong tao policy nao = chan sach PostgREST (anon/authenticated),
-- trong khi worker van ghi binh thuong.
--
-- Vi sao bat buoc: anon key se nam trong dashboard chay tren trinh duyet. Khong co
-- RLS thi bat ky ai co key do deu GHI duoc vao signals/signal_outcomes — tuc la lam
-- ban chinh du lieu dung de ket luan chien luoc co lai hay khong.
--
-- Hai bang market.bars_1s va market.liquidations nam o schema `market`, khong duoc
-- PostgREST phoi bay mac dinh, nen khong can.

alter table public.signals               enable row level security;
alter table public.signal_outcomes       enable row level security;
alter table public.setup_stats           enable row level security;
alter table public.ops_connection_events enable row level security;
alter table public.ops_ingest_stats      enable row level security;
alter table public.ops_stream_health     enable row level security;

-- View phai chay theo quyen cua nguoi truy van, khong phai nguoi tao view.
-- De SECURITY DEFINER thi view se lach qua dung cai RLS vua bat o tren.
alter view public.ops_uptime_24h set (security_invoker = on);
alter view public.v_performance  set (security_invoker = on);
