# scalping-lab — BTC Scalping Signal Lab

Hệ thống bắt tín hiệu scalping BTCUSDT perpetual (Binance USDⓈ-M): thu dữ liệu order flow
thời gian thực, phát signal có TP/SL rõ ràng, tự đo kết quả từng signal, và tự siết lại
chính nó dựa trên hiệu quả thật.

**Người làm:** Tin — sinh viên SE, quen Next.js, mới bắt đầu với futures crypto.
**Trạng thái:** chưa có code. Bắt đầu từ Tuần 1 trong lộ trình ở mục 9.

---

## Ràng buộc cứng — không được vi phạm

Đây là những điều đã được tính toán và chốt ở mục 1. Nếu một đề xuất mâu thuẫn với các
dòng dưới đây thì đề xuất đó sai, không phải ràng buộc sai.

1. **Mọi tính toán P&L phải trừ phí.** Binance USDⓈ-M VIP 0: maker 0.02%, taker 0.05% mỗi
   chiều. Không bao giờ báo cáo lợi nhuận gộp mà không kèm lợi nhuận ròng.
2. **Mục tiêu tối thiểu 250 điểm BTC** (~0.32% ở giá 77k). Không bao giờ đề xuất TP dưới
   mức này — TP 100 điểm cần win rate 88.7% để hoà vốn.
3. **Vào lệnh mặc định là limit (maker), không phải market.** Engine phải có trạng thái
   `pending` và điều kiện huỷ nếu không khớp trong N giây.
4. **Mọi signal bắt buộc có entry, stop, target, hạn hiệu lực.** Signal không có stop là
   signal không đo được.
5. **Mọi feature phải gắn timestamp "thời điểm thực sự khả dụng"**, không phải timestamp
   nến đóng. Đây là chống lookahead bias — ưu tiên cao hơn mọi tối ưu khác.
6. **Ingest worker là process thường trú.** KHÔNG deploy lên Vercel serverless — serverless
   không giữ được WebSocket dài hạn. Dùng Fly.io / Railway / VPS.
7. **Mặc định chạy shadow mode.** Không viết code tự động đặt lệnh cho tới khi qua cả 4 cửa
   ở mục 8. Hệ thống chỉ phát thông báo, con người vào lệnh.
8. **Không thêm feature hay indicator mới nếu chưa qua kiểm định walk-forward ngoài mẫu.**
   Tập dữ liệu nhỏ + nhiều feature = overfit.

## Stack đã chốt

| Thành phần | Công nghệ |
|---|---|
| Ingest + feature worker | Node 20 + TypeScript, thư viện `ws`, chạy thường trú |
| Lưu trữ | Postgres + TimescaleDB (dev: docker-compose; prod: Supabase hoặc VPS) |
| Dashboard | Next.js (App Router) trên Vercel |
| Chart | TradingView Lightweight Charts |
| Thông báo | Telegram Bot API |
| Tầng model (giai đoạn sau) | Python + LightGBM, phục vụ qua FastAPI |

## Quy ước code

- TypeScript strict mode. Không dùng `any` cho payload từ Binance — khai báo type thật.
- Giá và khối lượng dùng kiểu số nguyên theo tick/step hoặc `decimal`, **không dùng float**
  cho tính toán tiền.
- Mọi hằng số ngưỡng (3× trung vị thanh lý, percentile 90 funding, ...) nằm trong một file
  config duy nhất, không rải rác trong logic.
- Worker phải tự reconnect WebSocket có exponential backoff, và ghi log mỗi lần mất kết nối
  kèm khoảng thời gian mất — chỉ số uptime là tiêu chí qua Cửa 1.

## Bắt đầu từ đâu

Tuần 1 trong lộ trình: dựng ingest worker đọc `btcusdt@aggTrade`, `btcusdt@forceOrder`,
`btcusdt@bookTicker`, tổng hợp thành bar 1 giây, ghi xuống Postgres. Tiêu chí hoàn thành:
chạy 72 giờ liên tục không mất dữ liệu.

Chưa làm dashboard, chưa làm signal engine, chưa động tới model. Dữ liệu trước.

---
---

# BTC Scalping Signal Lab — Kế hoạch xây dựng

> Web bắt tín hiệu scalping BTCUSDT perp, có chart như Binance và đẩy thông báo khi setup
> xuất hiện. Thiết kế xoay quanh một sự thật: **phí giao dịch quyết định mục tiêu 100–200
> điểm có khả thi hay không**. Hệ thống này trước hết là máy đo, sau đó mới là máy phát tín hiệu.

Lập ngày 14/09/2026. Giá và phí cần kiểm tra lại khi triển khai.

| Tham chiếu | Giá trị |
|---|---|
| BTCUSDT | 77,324 USD |
| 200 điểm bằng | 0.259 % |
| Phí khứ hồi taker | 77.3 USD / BTC |
| Phí khứ hồi maker | 30.9 USD / BTC |
| WR hoà vốn TP200/SL100 (market) | 59.1 % |

---

## 1. Phép tính quyết định mọi thứ

BTC ở 77,324 → 100 điểm = **0.129%**, 200 điểm = **0.259%**.
Phí futures USDⓈ-M Binance VIP 0: maker **0.02%**, taker **0.05%**.
Một vòng vào–ra bằng lệnh market = **0.10%** = **77.3 USD / 1 BTC danh nghĩa**.
Trả phí bằng BNB giảm thêm 10%.

Tỷ lệ thắng tối thiểu để hoà vốn — `WR = (SL + phí) / (TP + SL)`, đơn vị điểm trên 1 BTC:

| Kịch bản | TP | SL | Vào/ra | Phí | Thắng ròng | Thua ròng | WR hoà vốn |
|---|---:|---:|---|---:|---:|---:|---:|
| Mục tiêu 100 điểm, market | 100 | 100 | taker/taker | 77.3 | +22.7 | −177.3 | **88.7%** |
| Mục tiêu 150 điểm, market | 150 | 100 | taker/taker | 77.3 | +72.7 | −177.3 | 70.9% |
| Mục tiêu 200 điểm, market | 200 | 100 | taker/taker | 77.3 | +122.7 | −177.3 | 59.1% |
| Mục tiêu 200 điểm, limit 2 đầu | 200 | 100 | maker/maker | 30.9 | +169.1 | −130.9 | **43.6%** |
| Mục tiêu 300 điểm, market | 300 | 100 | taker/taker | 77.3 | +222.7 | −177.3 | 44.3% |
| Mục tiêu 300 điểm, stop rộng, limit | 300 | 150 | maker/maker | 30.9 | +269.1 | −180.9 | 40.2% |

### Ba kết luận thiết kế

1. **Bỏ mục tiêu 100 điểm.** Cần thắng 88.7% để hoà vốn. Mục tiêu tối thiểu của hệ thống
   là **250–300 điểm** (~0.32–0.39%).
2. **Vào bằng limit, không phải market.** Taker/taker → maker/maker kéo WR hoà vốn từ
   59.1% xuống 43.6%, chỉ bằng một thay đổi loại lệnh. Đây là cải tiến lớn nhất có thể làm
   và không cần AI. Đổi lại: engine cần trạng thái `pending` và điều kiện huỷ nếu không
   khớp trong N giây.
3. **Signal phải kèm sẵn TP/SL, không chỉ hướng.** Tín hiệu không có stop là tín hiệu
   không đo được — không đo được thì không học được.

---

## 2. Kiến trúc

```
Binance Futures ──stream──> Ingest + Feature ──feature──> Signal engine ──signal──> Telegram + Web
  WS + REST                 Node worker, bar 1s          rule + cổng lọc            thông báo, chart
                                                              │  ▲
                                    mọi signal (kể cả shadow) │  │ bật/tắt setup · ngưỡng p̂
                                                              ▼  │
                          Thống kê + meta-model <──outcome── Kết quả lệnh
                          expectancy cuốn chiếu              MFE / MAE / R ròng

  ───── Postgres / TimescaleDB: bar 1s · feature · signal · kết quả · phiên bản model ─────
```

Luồng xuôi phát tín hiệu; vòng ngược là phần học. Mọi signal — kể cả signal bị cổng lọc
chặn — đều được theo dõi tới khi chạm TP hoặc SL, kết quả quay lại điều chỉnh cổng lọc.

### Stack

| Thành phần | Chọn | Lý do |
|---|---|---|
| Ingest worker | Node + TypeScript (`ws`), Fly.io / Railway | **Vercel serverless không giữ được WebSocket dài hạn** — bẫy số một của dự án. Worker phải thường trú. |
| Lưu trữ | Postgres + TimescaleDB (hoặc Supabase) | Bar 1s = 86.4k dòng/ngày, rất nhẹ. Không lưu raw trade quá 24h. |
| Dashboard | Next.js trên Vercel | Đúng stack đã quen. Chỉ đọc DB + một WS nhẹ cho giá live. |
| Chart | TradingView Lightweight Charts | Miễn phí, Apache 2.0, ~45KB, giống Binance, có API vẽ marker. |
| Thông báo | Telegram Bot API | Tức thì, miễn phí, vào thẳng điện thoại. Web Push dự phòng. |
| Tầng model | Python + LightGBM qua FastAPI | Tách khỏi worker để retrain không gián đoạn thu dữ liệu. |

Chi phí: worker ~5–7 USD/tháng, Vercel + Telegram miễn phí, Postgres free tier.
Tổng dưới 10 USD/tháng.

---

## 3. Nguồn dữ liệu "cảm xúc"

| Nguồn | Kênh | Nói lên điều gì |
|---|---|---|
| Giao dịch khớp lệnh | WS `btcusdt@aggTrade` | Phe taker mua hay bán chủ động — nguyên liệu CVD và OFI |
| Thanh lý | WS `btcusdt@forceOrder` | Vị thế bị ép đóng. Nền của setup S1 |
| Đỉnh sổ lệnh | WS `btcusdt@bookTicker` | Spread và mất cân bằng bid/ask mức tốt nhất |
| Độ sâu sổ lệnh | WS `btcusdt@depth20@100ms` | Áp lực chờ hai bên, tường mua/bán |
| Funding | REST `/fapi/v1/premiumIndex` | Funding dương cao = phe long đông, đang trả tiền để giữ |
| Open Interest | REST `/futures/data/openInterestHist` | OI tăng mà giá đứng = vị thế mới đang chất lên |
| Tỷ lệ long/short | REST `/futures/data/globalLongShortAccountRatio` | Retail đang lệch bên nào |
| Taker buy/sell | REST `/futures/data/takerlongshortRatio` | Kiểm chứng CVD tự tính |

> **Kỷ luật dữ liệu.** Mỗi feature ghi xuống DB phải gắn **thời điểm nó thực sự có thể biết
> được**, không phải thời điểm nến đóng. Endpoint REST như `openInterestHist` có độ trễ và
> tần suất 5 phút — gán giá trị OI của 10:05 vào feature tại 10:01 sẽ khiến backtest đẹp
> một cách giả tạo. Đây là lookahead bias, lý do phổ biến nhất khiến chiến lược "ăn đậm"
> trên backtest rồi thua sạch khi chạy thật.

---

## 4. Feature tính mỗi giây

Nghiên cứu 2026 về vi cấu trúc crypto trên chính Binance Futures perp cho thấy ba nhóm
feature áp đảo về đóng góp dự báo: **OFI**, **bid-ask spread**, **độ lệch VWAP so với mid**.
Spread rộng đi kèm khả năng dự báo *giảm* — nên đứng ngoài khi sổ lệnh mỏng.

| Feature | Cách tính | Vai trò |
|---|---|---|
| `ofi_10s` | Σ thay đổi vol bid − ask ở đỉnh sổ, cửa sổ 10s | Mạnh nhất theo tài liệu. Lõi của S3 |
| `cvd_60s` | Σ(vol mua taker − vol bán taker) trong 60s | Phe nào đang chủ động đẩy giá |
| `spread_bps` | (ask − bid) / mid × 10000 | **Bộ lọc âm**: > 2× trung vị 1h ⇒ không phát signal |
| `vwap_dev` | (mid − VWAP 5m) / ATR 5m | Giá đang căng khỏi vùng cân bằng bao xa |
| `book_imb` | Vol bid 20 mức / vol ask 20 mức | Áp lực chờ, xác nhận hướng |
| `liq_long_60s` / `liq_short_60s` | Tổng giá trị thanh lý mỗi bên trong 60s | Kích hoạt S1 |
| `oi_chg_4h` | % thay đổi Open Interest 4 giờ | Kích hoạt S2 |
| `funding_pct` | Percentile funding hiện tại so với 30 ngày | Mức độ chen chúc một bên |
| `atr_5m_pct` | ATR(5m) / giá × 100 | **Bộ lọc chế độ thị trường** |

> **Bộ lọc chế độ đứng trước mọi rule.** Kiểm định walk-forward nghiêm ngặt cho thấy lợi
> nhuận **chỉ xuất hiện trong giai đoạn biến động cao** và âm khi thị trường yên. Nếu
> `atr_5m_pct` dưới percentile 40 của 7 ngày gần nhất → **không phát signal nào**. Khi thị
> trường đi ngang biên hẹp thì mục tiêu 250–300 điểm không có đủ chỗ để chạy.

---

## 5. Ba setup khởi điểm

Mỗi setup là một giả thuyết viết được thành lời — "ai đó đang bị ép làm gì" — chứ không
phải điều kiện chỉ báo cắt nhau.

### S1 — Bật ngược sau cụm thanh lý (thường LONG)

Một cụm thanh lý ép hàng loạt vị thế đóng bằng lệnh market, đẩy giá quá đà trong vài giây.
Khi lực ép cạn, giá bật lại. Setup có lý do cơ học rõ nhất.

- **Kích hoạt** — trong 10s: giá trị thanh lý ≥ 3× trung vị cuộn 1h **và** giá tạo đáy mới
  15 phút **và** trong 5s sau đó CVD đảo chiều dương **và** spread đã về dưới 2× trung vị
- **Vào lệnh** — limit tại đáy flush + 0.05 × ATR(5m). Huỷ nếu không khớp trong 30s
- **Stop** — đáy flush − 0.40 × ATR(5m)
- **Mục tiêu** — 2.5R hoặc VWAP 15 phút, cái nào tới trước
- **Không vào khi** — chế độ ATR thấp; hoặc đã có 2 cụm thanh lý cùng chiều trong 10 phút
  (xu hướng thật, không phải quá đà)

### S2 — Siết vị thế khi funding và OI cùng cực đoan (thường SHORT)

Funding cao + OI tăng mạnh + giá không tạo được đỉnh mới = phe long vào muộn đang chất lên
mà không có người mua tiếp. Setup chậm nhất, giữ lệnh vài chục phút tới vài giờ —
"swing-scalp" cho đúng bản chất.

- **Kích hoạt** — `funding_pct` > 90 **và** `oi_chg_4h` > +2% **và** giá không vượt đỉnh 4h
  trong 30 phút gần nhất **và** `ofi_10s` chuyển âm
- **Vào lệnh** — limit tại mid, chờ tới 3 phút
- **Stop** — trên đỉnh 4h + 0.2 × ATR(5m)
- **Mục tiêu** — 2R, chốt một nửa tại 1.2R
- **Không vào khi** — còn dưới 30 phút tới giờ funding

### S3 — Phân kỳ dòng lệnh tại biên biên độ (LONG và SHORT)

Giá chạm biên dưới biên độ 30 phút nhưng OFI vẫn dương — người bán đang cạn trong khi người
mua âm thầm hấp thụ. Dựa trực tiếp trên feature mạnh nhất theo tài liệu, và phát nhiều tín
hiệu nhất nên là nơi tầng lọc AI có giá trị nhất.

- **Kích hoạt** — giá trong 10% dưới của biên độ 30 phút **và** `ofi_10s` dương liên tục 30s
  **và** `book_imb` > 1.5 nghiêng bid **và** `spread_bps` dưới trung vị. Đối xứng cho short
- **Vào lệnh** — limit tại bid tốt nhất
- **Stop** — 0.5 × ATR(5m) dưới biên
- **Mục tiêu** — 2R, hoặc giữa biên độ
- **Không vào khi** — biên độ 30 phút nhỏ hơn 400 điểm

Ba setup này là **giả thuyết để kiểm định, không phải công thức để tin**. Rất có thể sau
300 mẫu bạn phát hiện S2 âm expectancy và bỏ đi, còn S1 chỉ ăn trong phiên Mỹ. Đó chính là
kết quả hệ thống sinh ra.

---

## 6. Tầng tự học

Bốn mức, xếp theo độ an toàn giảm dần. Làm đúng thứ tự — mức 0 mang lại nhiều giá trị hơn mức 3.

### Mức 0 — Ghi sổ đầy đủ (không phải AI, nhưng là 80% của việc học)

Mỗi signal phát ra, kể cả signal bị cổng lọc chặn, lưu kèm **toàn bộ ảnh chụp feature tại
thời điểm đó**, rồi được theo dõi tự động tới khi chạm TP hoặc SL, ghi lại MFE, MAE và R
ròng sau phí. Không có lớp này thì không có gì để học.
*Rủi ro overfit: không. Bắt buộc.*

### Mức 1 — Cổng thích nghi theo hiệu quả cuộn

Với mỗi cặp (setup × chế độ × khung giờ), tính expectancy trên 50 signal gần nhất.
Expectancy ròng âm ⇒ **tự động tắt setup đó**, gửi thông báo, vẫn tiếp tục ghi nhận ở chế
độ shadow. Khi thống kê hồi phục thì tự bật lại. Dạng bandit đơn giản, gần như không thể
overfit vì chỉ dùng kết quả thật đã xảy ra.
*Rủi ro overfit: rất thấp. Đây là thứ đáng làm nhất.*

### Mức 2 — Meta-model lọc tín hiệu (meta-labeling)

Model **không dự báo giá**. Nó nhận "rule S3 vừa kích hoạt, đây là 24 feature tại thời điểm
đó" và trả lời một câu: *xác suất lệnh này chạm TP trước SL là bao nhiêu*. Nếu p̂ thấp hơn
WR hoà vốn cộng biên an toàn, signal bị chặn. Cách đặt bài toán này (López de Prado gọi là
meta-labeling) ít overfit hơn hẳn so với bắt model tự tìm điểm vào.

Model: LightGBM hoặc CatBoost. Nghiên cứu vi cấu trúc crypto dùng đúng họ này chứ không
phải mạng nơ-ron sâu — với dữ liệu bảng và tỷ lệ tín hiệu/nhiễu thấp, cây tăng cường
gradient thắng.
*Rủi ro overfit: trung bình. Cần tối thiểu 200 mẫu/setup trước khi tin.*

### Mức 3 — Vòng nghiên cứu có LLM hỗ trợ

Mỗi tuần một job tổng hợp signal thua, gom cụm theo feature, sinh giả thuyết dạng chữ:
*"12/15 lệnh S1 thua đều có spread trên percentile 80 tại thời điểm vào — đề xuất siết
ngưỡng spread"*. Giả thuyết vào **hàng đợi nghiên cứu**, bạn duyệt, rồi kiểm định bằng đúng
bộ khung walk-forward như mọi thay đổi khác.

Về ý "để nó tự lên mạng tìm indicator mới": một agent tự đọc blog rồi tự thêm indicator
nghe hay nhưng hại nhiều hơn lợi — nó sẽ liên tục thêm feature vào một tập dữ liệu nhỏ, và
đó là định nghĩa của overfit. Cái thực sự hoạt động là hàng đợi ứng viên có kỷ luật: mọi ý
tưởng, dù đến từ bài báo, forum hay LLM, đều qua cùng bộ kiểm định và chỉ được nhận nếu cải
thiện expectancy **ngoài mẫu**.
*Rủi ro overfit: cao nếu tự động hoá hoàn toàn. Luôn giữ người duyệt ở giữa.*

### Bốn lan can chống tự lừa mình

- **Tách mẫu có purge và embargo.** Nhãn của một signal kéo dài vài phút sau thời điểm vào,
  nên mẫu train và test chồng lấn thời gian sẽ rò rỉ thông tin. Cắt vùng chồng lấn và chừa
  thêm khoảng đệm.
- **Walk-forward, không phải một lần chia.** Train trên cửa sổ cuộn, test trên đoạn kế tiếp
  chưa từng thấy, rồi trượt. Tốt trên một lần chia là may mắn; tốt trên 20 đoạn liên tiếp
  mới là tín hiệu.
- **Champion / challenger.** Model mới chạy song song ở shadow ít nhất 2 tuần. Chỉ thay thế
  khi vượt model đang chạy trên dữ liệu chưa thấy.
- **Đóng băng bộ test cuối.** Chừa một tháng dữ liệu *không bao giờ* nhìn trong lúc phát
  triển. Mỗi lần nhìn rồi chỉnh sửa, nó không còn là ngoài mẫu nữa.

---

## 7. Thông báo và giao diện

```
🟢 LONG · S1 Bật ngược sau thanh lý
BTCUSDT · 77,312

Entry   77,305  limit, hiệu lực 30s
Stop    77,205  −100  (0.13%)
Target  77,555  +250  (2.5R)

p̂ 0.58  ·  WR hoà vốn 0.44  ·  biên +0.14
Chế độ  BIẾN ĐỘNG CAO
S1 trong 30 ngày:  n=84  WR 51%  expR +0.21

Khối lượng gợi ý 0.043 BTC  (rủi ro 0.5% tài khoản)
```

Ba dòng cuối khiến thông báo này khác bot signal thường: nó cho thấy **xác suất model ước
lượng, ngưỡng hoà vốn, và thành tích thật gần đây của chính setup đó**. Khi biên dương mỏng
hoặc n còn nhỏ, bạn biết để bỏ qua.

### Dashboard gồm bốn trang

- **Live** — chart nến Lightweight Charts với marker signal, dải panel feature realtime bên
  dưới (CVD, OFI, thanh lý, funding, OI)
- **Nhật ký signal** — bảng mọi signal kèm kết quả, lọc theo setup / chế độ / khung giờ.
  Bấm một dòng thì chart nhảy tới đúng thời điểm
- **Thống kê** — expectancy ròng theo setup × chế độ × giờ, đường vốn, chuỗi thua dài nhất,
  phân bố MFE/MAE. Trang sẽ mở nhiều nhất
- **Hàng đợi nghiên cứu** — giả thuyết đang chờ kiểm định và kết quả walk-forward

### Lược đồ cơ sở dữ liệu

```sql
create table signals (
  id           bigserial primary key,
  ts           timestamptz not null,     -- thời điểm phát
  setup        text not null,            -- S1 | S2 | S3
  side         text not null,
  entry_px     numeric, stop_px numeric, target_px numeric,
  regime       text,
  p_hat        numeric,                  -- xác suất từ meta-model
  be_wr        numeric,                  -- WR hoà vốn tại TP/SL này
  gated        boolean not null,         -- bị cổng lọc chặn?
  model_ver    int references model_versions(id),
  features     jsonb not null            -- ảnh chụp toàn bộ feature
);

create table signal_outcomes (
  signal_id    bigint primary key references signals(id),
  resolved_ts  timestamptz,
  result       text,                     -- tp | sl | timeout | nofill
  mfe_pts      numeric, mae_pts numeric,
  r_gross      numeric,
  r_net        numeric                   -- SAU phí — cột quan trọng nhất bảng này
);

create table setup_stats (
  setup text, regime text, hour_bucket int,
  window_n int, win_rate numeric, exp_r_net numeric,
  enabled boolean, updated_at timestamptz,
  primary key (setup, regime, hour_bucket)
);
```

---

## 8. Cổng ra tiền thật

Bốn cửa, đi tuần tự. Mỗi cửa có tiêu chí số, không phải cảm giác "thấy nó chạy ngon".

**Cửa 1 — Shadow, chỉ phát signal, không vào lệnh.** Tối thiểu 4 tuần. Qua cửa khi: hệ thống
không mất kết nối quá 0.5% thời gian, và mỗi setup tích luỹ ít nhất **200 signal đã có kết quả**.

**Cửa 2 — Kiểm chứng thống kê.** Ít nhất một setup đạt **expectancy ròng > +0.15R** sau phí,
trên ≥ 200 mẫu, và dương trên đa số đoạn walk-forward chứ không nhờ vài lệnh thắng đậm.
Kiểm tra thêm: bỏ 5 lệnh lãi nhất ra thì expectancy còn dương không?

**Cửa 3 — Paper trade thủ công.** 2 tuần tự vào lệnh trên demo theo đúng signal. Mục đích
không phải kiểm định rule nữa mà kiểm định *bạn*: độ trễ thực tế từ lúc nhận thông báo tới
lúc đặt lệnh, tỷ lệ khớp limit thật, và bạn có tuân thủ được không.

**Cửa 4 — Tiền thật, quy mô nhỏ nhất.** Rủi ro **0.25% tài khoản** mỗi lệnh trong tháng đầu.
Tối đa 3 lệnh/ngày. Dừng ngày sau 2 lệnh thua liên tiếp. Margin isolated. Không bao giờ dời stop.

> **Cảnh báo về đòn bẩy.** Stop 100 điểm chỉ bằng 0.13% giá. Để rủi ro 0.5% tài khoản
> 1,000 USD (5 USD) với stop đó, khối lượng phải là 0.05 BTC — tương đương **3,865 USD danh
> nghĩa, gần 4× đòn bẩy**. Stop càng hẹp thì đòn bẩy danh nghĩa càng cao để giữ cùng mức rủi
> ro, và giá thanh lý càng gần. Luôn tính khối lượng *từ khoảng cách stop*, không bao giờ
> chọn đòn bẩy trước rồi suy ngược.

---

## 9. Lộ trình 8 tuần

Thứ tự có chủ đích: dữ liệu trước, tín hiệu sau, AI sau cùng. Đảo thứ tự là cách chắc chắn
nhất để phí công.

| Tuần | Làm gì | Xong nghĩa là |
|---|---|---|
| 1 | Ingest worker: WS aggTrade + forceOrder + bookTicker, dựng bar 1s, ghi DB | Chạy 72h liên tục không mất dữ liệu, tự reconnect khi rớt |
| 2 | Feature engine: 9 feature ở mục 4, kèm cột thời điểm khả dụng | Query được chuỗi feature bất kỳ theo giây |
| 3 | Dashboard Live: chart + panel feature realtime | Ngồi xem và bắt đầu *đọc* được thị trường qua dòng lệnh |
| 4 | Signal engine 3 setup + Telegram bot, **shadow mode** | Nhận thông báo trên điện thoại, chưa vào lệnh nào |
| 5 | Outcome tracker + trang Thống kê | Mỗi signal tự có kết quả và R ròng sau phí |
| 6 | Tầng thích nghi mức 1: bộ lọc chế độ + cổng theo expectancy cuộn | Hệ thống tự tắt setup đang hỏng |
| 7–8 | Meta-model LightGBM + walk-forward + champion/challenger | Có p̂ trong mỗi thông báo, biết model có thật sự hơn rule trần không |

Sau tuần 4 đã có sản phẩm dùng được và một thứ đáng đưa vào CV — hệ thống dữ liệu thời gian
thực có đo lường, không phải một web vẽ chart.

---

## 10. Phần phải nói thẳng

Khi tín hiệu vi cấu trúc thị trường được kiểm định bằng walk-forward nghiêm ngặt — đúng loại
kỷ luật ở mục 6 — kết quả công bố 2025 là: **lợi nhuận 0.55%/năm, Sharpe 0.33, p-value 0.34,
tỷ lệ thắng 46.5% trên 140 lệnh**. Nghĩa là *không phân biệt được với ngẫu nhiên*. Các con số
15–30%/năm thường thấy chủ yếu đến từ backtest một lần chia và lookahead bias. Khảo sát 2026
về model ML dự báo giá Bitcoin cũng kết luận phần lớn là overfit.

Điều đó không có nghĩa là đừng làm. Nó có nghĩa là **đặt mục tiêu đúng chỗ**:

- **Gần như chắc chắn** — xây được hệ thống dữ liệu thời gian thực tử tế, hiểu vi cấu trúc
  thị trường sâu hơn 99% người chơi futures, có dự án portfolio mạnh cho kỳ OJT.
- **Có thể xảy ra** — tìm được lợi thế nhỏ, giới hạn trong một chế độ thị trường và khung giờ
  cụ thể, đủ để dương sau phí nhưng không đủ để đổi đời.
- **Không nên kỳ vọng** — một máy in tiền. Nếu tồn tại rule đơn giản ăn 300 điểm đều đặn trên
  BTCUSDT, các quỹ HFT đặt máy cạnh sàn đã ăn hết phần đó từ lâu.

Quan trọng hơn kỹ thuật: scalping là kiểu giao dịch khó nhất để bắt đầu — phí cao nhất tính
theo % lợi nhuận, áp lực tâm lý lớn nhất, và đòn bẩy cần cho stop hẹp khiến sai lầm bị phóng
đại nhanh nhất. Hãy để dự án chạy ở shadow đủ lâu. Phần giá trị nhất nằm ở những gì học được
từ dữ liệu, không phải ở những lệnh vào trong tháng đầu.

*Đây là tài liệu kỹ thuật, không phải lời khuyên đầu tư.*

---

## Nguồn

- [Bitcoin Price — CoinDesk](https://www.coindesk.com/price/bitcoin) — giá BTC 77,324 USD, 14/09/2026
- [Binance Futures Fees Explained](https://dappgrid.com/binance-futures-fees-explained/) — USDⓈ-M VIP 0: maker 0.02%, taker 0.05%, giảm 10% khi trả bằng BNB
- [Interpretable Hypothesis-Driven Trading: A Rigorous Walk-Forward Validation Framework for Market Microstructure Signals](https://arxiv.org/html/2512.12924v1)
- [Explainable Patterns in Cryptocurrency Microstructure](https://arxiv.org/html/2602.00776v1) — OFI, spread, VWAP deviation; CatBoost
- [Machine Learning Models for Bitcoin Price Prediction: Mostly Overfit (2026)](https://www.geekmetaverse.com/machine-learning-models-for-bitcoin-price-prediction-mostly-overfit-2026-study/)
