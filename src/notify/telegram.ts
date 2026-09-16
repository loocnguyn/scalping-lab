/**
 * Gui signal qua Telegram.
 *
 * Vi sao Telegram thay vi email: signal scalping chi song 30-180 giay. Email thuong
 * mat 5-30 giay de toi va nguoi ta khong mo mail ngay; Telegram day thang notification
 * vao man hinh khoa. Voi khung thoi gian nay, do tre la khac biet giua "vao duoc lenh"
 * va "doc lai xem no da chay the nao".
 *
 * Khong them phu thuoc nao — dung fetch san co cua Node 20+.
 *
 * BA NGUYEN TAC (giong mailer):
 *  1. CHI gui signal KHONG bi cong loc chan. Gui het thi nguoi doc quen cach phan
 *     biet, va do la cach nhanh nhat de bien thong bao thanh rac roi bi bo qua.
 *  2. Loi gui KHONG BAO GIO lam chet worker — uptime la tieu chi Cua 1.
 *  3. Co tran so tin nhan. Telegram gioi han 30 tin/giay va se khoa bot neu vuot;
 *     mot su co lap lai moi giay du de bi khoa.
 */

import { TELEGRAM } from '../config/index.js';
import { log, errFields } from '../lib/logger.js';
import type { Signal } from '../signal/engine.js';

export interface NotifyDeps {
  suggestedQty(s: Signal): number;
  notionalLeverage(s: Signal): number;
  recentStats(setup: string, regime: string): { n: number; winRate: number; expRNet: number } | null;
}

/** WR hoa von tai TP/SL nay, da tinh phi. Cong thuc o muc 1 ke hoach. */
function breakevenWr(tpPoints: number, slPoints: number, fees: number): number {
  return (slPoints + fees) / ((tpPoints - fees) + (slPoints + fees));
}

/** Telegram HTML parse mode chi cho phep vai the; phai escape phan con lai. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class TelegramNotifier {
  #sent = 0;
  #failed = 0;
  #sentThisHour = 0;
  #hourStartedAt = Date.now();
  #recent = new Set<string>();
  #ready = false;

  get stats(): { sent: number; failed: number; enabled: boolean } {
    return { sent: this.#sent, failed: this.#failed, enabled: this.#ready };
  }

  /**
   * Xac minh token va chat id NGAY luc khoi dong.
   * Neu doi toi signal dau tien moi biet sai cau hinh thi co the mat vai gio — va do
   * dung la luc khong duoc mat.
   */
  async start(): Promise<void> {
    if (!TELEGRAM.enabled) {
      log.warn('telegram.disabled', {
        note: 'Chua cau hinh TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID — se KHONG co thong bao nao.',
      });
      return;
    }
    try {
      const me = await this.#api<{ username: string }>('getMe', {});
      this.#ready = true;
      log.info('telegram.ready', { bot: me.username, chatId: TELEGRAM.chatId });
    } catch (e) {
      log.error('telegram.verify_failed', {
        ...errFields(e),
        note: 'Kiem tra lai token tu @BotFather va chat id. Phai nhan tin cho bot truoc khi no gui duoc cho ban.',
      });
    }
  }

  async #api<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TELEGRAM.timeoutMs);
    try {
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
      if (!json.ok) throw new Error(json.description ?? `Telegram tra ve ok=false cho ${method}`);
      return json.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  #underHourlyCap(): boolean {
    const now = Date.now();
    if (now - this.#hourStartedAt > 3_600_000) {
      this.#hourStartedAt = now;
      this.#sentThisHour = 0;
    }
    return this.#sentThisHour < TELEGRAM.maxPerHour;
  }

  /** Gui signal. Khong await o phia goi — mang cham khong duoc lam cham duong xu ly bar. */
  notifySignal(s: Signal, deps: NotifyDeps): void {
    if (!this.#ready) return;
    if (s.gated) return; // Nguyen tac 1

    if (this.#recent.has(s.id)) return;
    this.#recent.add(s.id);
    if (this.#recent.size > 500) this.#recent.clear();

    if (!this.#underHourlyCap()) {
      log.warn('telegram.rate_limited', { maxPerHour: TELEGRAM.maxPerHour, setup: s.setup });
      return;
    }
    this.#sentThisHour += 1;

    const up = s.side === 'LONG';
    const qty = deps.suggestedQty(s);
    const lev = deps.notionalLeverage(s);
    const st = deps.recentStats(s.setup, s.regime);
    // Vao maker, cat lo taker — dung mo hinh cua paper broker.
    const fees = s.entryPx * 0.0002 + s.stopPx * 0.0005;
    const beWr = breakevenWr(s.targetPoints, s.stopPoints, fees);
    const secs = Math.max(0, Math.round((s.expiresAt.getTime() - Date.now()) / 1000));
    const dp = s.entryPx >= 1000 ? 1 : 2;

    const text = [
      `${up ? '🟢' : '🔴'} <b>${s.side}</b> · ${esc(s.setup)} · <b>${esc(s.symbol)}</b>`,
      '',
      '<pre>',
      `Entry   ${s.entryPx.toFixed(dp).padStart(10)}   LIMIT ${secs}s`,
      `Stop    ${s.stopPx.toFixed(dp).padStart(10)}   ${up ? '-' : '+'}${Math.round(s.stopPoints)}`,
      `Target  ${s.targetPx.toFixed(dp).padStart(10)}   ${up ? '+' : '-'}${Math.round(s.targetPoints)}  (${s.rMultiple.toFixed(2)}R)`,
      '</pre>',
      `Khối lượng  <code>${qty}</code>   ·   đòn bẩy danh nghĩa <code>${lev.toFixed(2)}x</code>`,
      `WR hoà vốn sau phí  <b>${(beWr * 100).toFixed(1)}%</b>`,
      `Chế độ  ${esc(s.regime)}`,
      st === null
        ? `${esc(s.setup)} gần đây: <i>chưa đủ mẫu để tin</i>`
        : `${esc(s.setup)} gần đây: n=${st.n} · WR ${(st.winRate * 100).toFixed(0)}% · expR ${st.expRNet > 0 ? '+' : ''}${st.expRNet.toFixed(3)}`,
      '',
      `<i>Bạn tự vào lệnh — hệ thống không đặt lệnh nào. Vào LIMIT, huỷ nếu không khớp trong ${secs}s. Không dời stop.</i>`,
    ].join('\n');

    void this.#api('sendMessage', {
      chat_id: TELEGRAM.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    })
      .then(() => {
        this.#sent += 1;
        log.info('telegram.sent', { signalId: s.id.slice(0, 8), setup: s.setup, symbol: s.symbol });
      })
      .catch((e: unknown) => {
        // Nguyen tac 2: loi gui khong duoc lam chet worker.
        this.#failed += 1;
        log.error('telegram.send_failed', { signalId: s.id.slice(0, 8), ...errFields(e) });
      });
  }

  /** Canh bao van hanh — stream bat buoc im lang, worker gap su co. */
  notifyOps(title: string, body: string): void {
    if (!this.#ready || !this.#underHourlyCap()) return;
    this.#sentThisHour += 1;
    void this.#api('sendMessage', {
      chat_id: TELEGRAM.chatId,
      text: `⚠️ <b>${esc(title)}</b>\n\n${esc(body)}`,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    })
      .then(() => { this.#sent += 1; })
      .catch((e: unknown) => {
        this.#failed += 1;
        log.error('telegram.ops_failed', errFields(e));
      });
  }
}
