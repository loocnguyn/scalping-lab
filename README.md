# scalping-lab

Hệ thống bắt tín hiệu scalping BTCUSDT perpetual (Binance USDⓈ-M): thu order flow thời gian
thực, phát signal có TP/SL rõ ràng, **tự vào lệnh mô phỏng và tự đo thắng/thua sau phí**, rồi
tự siết lại chính nó dựa trên hiệu quả thật.

Kế hoạch đầy đủ và các ràng buộc cứng nằm trong [CLAUDE.md](CLAUDE.md).

> **Chế độ shadow.** Hệ thống tự động vào lệnh và đo kết quả, nhưng là **lệnh mô phỏng**.
> Không có dòng code nào gửi lệnh lên Binance. Đây là ràng buộc cứng #7: không tự động đặt
> lệnh thật cho tới khi qua cả 4 cửa ở mục 8 kế hoạch. Kết quả paper là thứ duy nhất cho biết
> có nên đi tiếp hay không.

---

## Vòng lặp

```
WebSocket ──> bar 1 giây ──> feature ──> signal engine ──> paper broker
     ▲                                                          │
     │                                                          ▼
cổng thích nghi <──── expectancy ròng sau phí <──── kết quả TP/SL
```

| Tầng | File | Việc |
|---|---|---|
| Ingest | `src/ws/`, `src/ingest/` | WebSocket tự reconnect, định tuyến, REST funding/OI |
| Bar 1s | `src/bar/aggregator.ts` | Gộp thành bar 1 giây, sinh `available_at` |
| Feature | `src/features/engine.ts` | 9 feature ở mục 4, cuốn chiếu |
| Signal | `src/signal/engine.ts` | S1/S2/S3 + bộ lọc chế độ + cưỡng chế ràng buộc cứng |
| Paper | `src/paper/broker.ts` | Khớp lệnh mô phỏng, TP/SL, phí, R ròng |
| Học | `src/learn/gate.ts` | Expectancy cuốn chiếu, tự tắt setup thua |

---

## Chạy

```bash
npm install
cp .env.example .env    # điền DATABASE_URL
npm run migrate
npm run dev
```

Chạy thử không cần DB — đọc dữ liệu Binance thật, in bar ra stdout:

```bash
DRY_RUN=1 npm run dev
```

Kiểm chứng bộ tính tiền (đối chiếu với bảng ở mục 1 kế hoạch):

```bash
DRY_RUN=1 npx tsx scripts/test-broker.ts
```

Báo cáo tiêu chí Cửa 1:

```bash
npm run uptime
```

---

## Trạng thái stream — đọc phần này trước khi tin bất kỳ con số nào

Đo ngày 14/09/2026 trên `wss://fstream.binance.com`. Một nhóm stream **nhận subscribe rồi
không bao giờ gửi gì**: không báo lỗi, không đóng kết nối, socket vẫn `OPEN`, ping/pong vẫn chạy.

| Stream | Trạng thái | Hệ quả |
|---|---|---|
| `@trade` | ✅ ~39 msg/giây | OHLCV, CVD, VWAP |
| `@bookTicker` | ✅ ~600 msg/giây | spread, best bid/ask |
| `@depth20@100ms` | ✅ ~10 msg/giây | `book_imb` |
| `@aggTrade` | ❌ im lặng | → đã thay bằng `@trade` |
| `@forceOrder` | ❌ im lặng | **setup S1 không thể kích hoạt** |
| `@kline_*`, `@markPrice` | ❌ im lặng | không dùng |

Đối chiếu: REST `/fapi/v1/aggTrades` trả về bình thường (1000 lệnh/60 giây), và endpoint
**spot** `@aggTrade` cũng chạy bình thường. Nên đây không phải mạng bị chặn, mà là một nhóm
stream của endpoint futures đang không phát.

**Vì sao điều này nguy hiểm hơn một lỗi thông thường:** nếu chỉ đo uptime ở cấp socket,
worker sẽ báo *"chạy 72h không sự cố"* trong khi cột `liq_*` toàn bằng 0 và setup S1 im lặng
vĩnh viễn. Đó là mất dữ liệu mà không biết.

Nên hệ thống có hai lớp bảo vệ, ở `src/ws/stream-health.ts`:

1. **Probe lúc khởi động** — mở kết nối thử 15 giây, đếm message từng stream, log ngay cái
   nào chết.
2. **Giám sát tần suất liên tục** — mỗi stream khai báo `minMsgPerMin`; dưới ngưỡng thì cảnh
   báo `stream.silent` và ghi vào `ops_stream_health`.

`@forceOrder` để `minMsgPerMin: 0` vì thanh lý **thực sự** thưa thớt — không thể phân biệt
"không có thanh lý" với "stream chết" bằng tần suất. Probe lúc khởi động là thứ phân biệt được.

---

## Bốn quyết định bi quan có chủ ý

Trong `src/paper/broker.ts`. Mỗi cái đều làm kết quả **xấu đi** so với mô phỏng ngây thơ.
Đó là chủ đích — mô hình khớp lạc quan chính là cách backtest nói dối.

1. **Lệnh limit chỉ khớp khi giá đi xuyên qua**, không phải chạm là khớp. Chạm giá nghĩa là
   đang xếp hàng cuối sổ lệnh.
2. **Chạm cả TP và SL trong cùng một giây → tính là SL.** Không biết cái nào đến trước, chọn
   khả năng xấu.
3. **Vào và chốt lời tính phí maker, cắt lỗ tính phí taker** — vì stop thật sự là lệnh
   stop-market.
4. **Trượt một tick khi cắt lỗ.**

Đối chiếu với bảng ở mục 1 kế hoạch (`scripts/test-broker.ts`, tất cả pass):

| Kịch bản | Kết quả |
|---|---|
| Phí khứ hồi maker | 30.97 USDT/BTC (kế hoạch: 30.9) |
| TP 250 / SL 100, chạm TP | R ròng **+2.190** |
| Chạm SL (taker + trượt tick) | R ròng **−1.542** |
| Khối lượng, tài khoản 1000 USDT, rủi ro 0.5% | 0.05 BTC — **đòn bẩy danh nghĩa 3.87×** |

Dòng cuối là con số người ta hay quên kiểm tra: stop hẹp buộc đòn bẩy danh nghĩa cao để giữ
cùng mức rủi ro. Khối lượng luôn tính **từ khoảng cách stop**, không bao giờ chọn đòn bẩy
trước rồi suy ngược.

---

## Chống lookahead

Ràng buộc cứng #5, ưu tiên cao hơn mọi tối ưu khác. Mọi bảng dữ liệu có **hai** mốc thời gian:

| Cột | Nghĩa |
|---|---|
| `bar_ts` / `event_ts` | dữ liệu thuộc về lúc nào |
| `available_at` | worker **thực sự biết được** lúc nào |

Mọi backtest và feature engine phải lọc theo `available_at`. DB cưỡng chế bằng
`check (available_at >= bar_ts)`. Đo thực tế: độ trễ ~1.3 giây (1 giây chờ bar đóng + 250ms
grace + thời gian xử lý).

`openInterestHist` có tần suất 5 phút **và** có độ trễ — gán giá trị OI của 10:05 vào quyết
định tại 10:01 sẽ làm backtest đẹp một cách giả tạo. `src/ingest/rest-poller.ts` gắn
`available_at = lúc response về tay ta`, không phải timestamp Binance trả về.

---

## Ràng buộc cứng được cưỡng chế ở đâu

Không dựa vào ý thức người viết code — mỗi ràng buộc có một chỗ chặn cụ thể:

| # | Ràng buộc | Cưỡng chế tại |
|---|---|---|
| 1 | Mọi P&L phải trừ phí | `broker.ts` — `rNet` là cột nguồn của mọi kết luận |
| 2 | TP tối thiểu 250 điểm | `signal/engine.ts#build` **và** `check (target_points >= 250)` trong DB |
| 3 | Vào bằng limit, có hạn hủy | `broker.ts` trạng thái `pending` → `nofill` |
| 4 | Mọi signal có entry/stop/target/hạn | `Signal` bắt buộc đủ trường, `#build` kiểm tra nhất quán |
| 5 | Timestamp khả dụng | `available_at` ở mọi bảng + check constraint |
| 6 | Worker không lên Vercel | `Dockerfile` + `fly.toml`, ghi rõ trong code |
| 7 | Shadow mode | Không tồn tại code đặt lệnh. Không có API key nào được đọc |
| 8 | Không thêm feature khi chưa walk-forward | 9 feature khóa trong `features/engine.ts` |

Ràng buộc #2 được kiểm chứng: DB từ chối signal TP 100 điểm với `check_violation`.

---

## Triển khai 24/24

Worker giữ WebSocket dài hạn nên **không chạy được trên Vercel serverless**.

```bash
fly launch --no-deploy
fly secrets set DATABASE_URL="postgresql://..."
fly deploy
```

Đã có sẵn `Dockerfile`, `fly.toml` (vùng `sin`, cùng vùng Supabase), `railway.json`.
Không bật `auto_stop` — máy ngủ là mất dữ liệu.

---

## Tiêu chí hoàn thành

**Tuần 1** — chạy 72 giờ liên tục không mất dữ liệu, tự reconnect. Đo bằng `npm run uptime`.

**Cửa 1** — mất kết nối dưới 0.5% thời gian, mỗi setup ≥ 200 signal có kết quả.
`ops_uptime_24h` tính sẵn, cột `passes_gate1`.

Hiện tại tiêu chí Tuần 1 **chưa thể đạt** vì `@forceOrder` không phát — setup S1 sẽ không
tích được signal nào. `@trade`, `@bookTicker`, `@depth20` đã chạy ổn định.

---

## Điều phải nói thẳng

Kiểm định walk-forward nghiêm ngặt trên tín hiệu vi cấu trúc cho kết quả công bố 2025:
lợi nhuận 0.55%/năm, Sharpe 0.33, p-value 0.34 — *không phân biệt được với ngẫu nhiên*.

Hệ thống này trước hết là **máy đo**, sau đó mới là máy phát tín hiệu. Giá trị chắc chắn thu
được là hiểu vi cấu trúc thị trường và một dự án dữ liệu thời gian thực tử tế. Một máy in tiền
thì không nên kỳ vọng — nếu tồn tại rule đơn giản ăn 300 điểm đều đặn trên BTCUSDT, các quỹ
HFT đặt máy cạnh sàn đã ăn hết phần đó từ lâu.

*Đây là tài liệu kỹ thuật, không phải lời khuyên đầu tư.*
