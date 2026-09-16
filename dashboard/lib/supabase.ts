import { createClient } from '@supabase/supabase-js';

/**
 * Client doc-only cho dashboard.
 *
 * Key nay la publishable key — thiet ke de nam trong trinh duyet. RLS chi mo quyen
 * SELECT cho role anon; moi INSERT/UPDATE/DELETE deu bi chan o tang DB (da kiem tra:
 * POST tra 401 "new row violates row-level security policy").
 *
 * Nghia la: ai co URL dashboard deu DOC duoc du lieu, nhung khong ai GHI duoc —
 * nen khong ai lam ban duoc chinh du lieu dung de ket luan chien luoc lai hay lo.
 */
/**
 * Gia tri mac dinh cho project scalping-lab. Khong phai bi mat: publishable key duoc
 * thiet ke de nam trong trinh duyet, va bat ky ai mo dashboard cung tai duoc no tu
 * bundle. De san o day de deploy chay ngay ma khong phai cau hinh them; van cho phep
 * ghi de bang bien moi truong khi doi project.
 *
 * Bi mat THAT SU — mat khau Postgres, service_role key — khong bao gio duoc xuat hien
 * o tang nay. Worker giu chung, va worker khong chay tren Vercel.
 */
const DEFAULT_URL = 'https://fedhavhjkmsweyhsxkkk.supabase.co';
const DEFAULT_KEY = 'sb_publishable_gNxrf3C8oNlUxEFT14GCLQ_9oXCZ8He';

const url = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? DEFAULT_URL;
const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? DEFAULT_KEY;

export const configured = url !== '' && key !== '';

export const supabase = createClient(url || 'https://placeholder.supabase.co', key || 'placeholder', {
  auth: { persistSession: false },
});

export interface Overview {
  bars_total: number;
  bars_from: string | null;
  bars_to: string | null;
  liq_total: number;
  signals_total: number;
  signals_active: number;
  trades_closed: number;
  exp_r_net: number | null;
  total_r_net: number | null;
  n_tp: number;
  n_sl: number;
  n_nofill: number;
}

/**
 * Truy van an toan: loi mang hay DB khong duoc lam trang trang.
 *
 * Kieu tra ve de `unknown` roi ep sang T o day, vi supabase-js khong suy duoc kieu
 * tu chuoi select co truy van long (vi du 'signals(...),signal_outcomes(...)') — no
 * tra ve GenericStringError[]. Ep o MOT cho nay tot hon rai `as` khap cac trang.
 */
export async function safeQuery<T>(
  fn: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<{ rows: T[]; error: string | null }> {
  if (!configured) {
    return { rows: [], error: 'Chưa cấu hình NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY' };
  }
  try {
    const { data, error } = await fn();
    if (error !== null && error !== undefined) {
      const msg = typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error);
      return { rows: [], error: msg };
    }
    return { rows: Array.isArray(data) ? (data as T[]) : [], error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Postgres tra numeric duoi dang string. Ep sang so o mot cho, khong rai khap cac trang. */
export function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
