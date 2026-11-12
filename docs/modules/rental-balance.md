# Ghi nhận phần tiền thuê còn lại trước bàn giao

Chủ dự án duyệt ngày 12/11/2026. Chỉ mô phỏng: hệ thống không thu tiền thật; bản ghi là việc nhân viên xác nhận đã thu tại quầy. Hóa đơn vẫn không chứng minh đã thanh toán.

## Quy tắc

- **Khoản còn lại** = tổng báo giá (tiền thuê + phí tuyến) trừ cọc giữ chỗ của đơn. Đơn không cọc: toàn bộ tổng. Cọc đã nằm trong tiền thuê nên không cộng thêm.
- Staff chi nhánh nhận ghi nhận **một lần**, đúng bằng khoản còn lại: phương thức tiền mặt (`CASH`) hoặc chuyển khoản (`BANK_TRANSFER`, bắt buộc mã tham chiếu), số phiếu thu tùy chọn với tiền mặt, xác nhận đã đối chiếu. Không ghi thiếu, thừa hoặc nhiều đợt.
- **Bắt buộc trước bàn giao:** đơn áp dụng mà chưa ghi nhận thì không chuyển sang Đang thuê. Đơn có cọc chỉ ghi nhận khi cọc đã áp dụng đủ.
- **Sửa ghi nhận sai:** Admin đảo toàn bộ bản ghi hiện hành một lần, bắt buộc lý do; Staff chi nhánh nhận ghi lại bản đúng. Được ghi nhận/đảo khi đơn Đã xác nhận, Đang thuê hoặc Đã nhận trả; sau Hoàn tất không đổi. Nếu bản ghi bị đảo sau bàn giao, đơn không hoàn tất được cho tới khi ghi lại.
- **Phạm vi áp dụng:** chỉ đơn tạo khi cờ `RENTAL_BALANCE_ENABLED` (`app.rental-balance-enabled`) bật; đơn lưu phiên bản `rental-balance-v1`. Mặc định **tắt**. Đơn cũ (không có phiên bản) giữ quy trình bàn giao cũ, không truy thu. `RENTAL_BALANCE_DEMO` (mặc định `true`) gắn nhãn mô phỏng, lưu theo từng bản ghi.
- Không dùng sổ cọc `payment_*` và không trộn với khoản vượt hạn (`booking_return_settlements`).

## API (dưới `/api/v1`)

| Phương thức | Đường dẫn | Quyền | Thân |
|---|---|---|---|
| POST | `/bookings/{id}/rental-balance` | Staff chi nhánh nhận | `amountVnd` (số nguyên JSON = khoản còn lại), `method`, `reference`, `idempotencyKey` (≤80), `expectedVersion`, `confirmed: true` |
| POST | `/bookings/{id}/rental-balance/reverse` | Admin | `reason` (≤1000), `idempotencyKey`, `expectedVersion`, `confirmed: true` |

Khóa xe rồi đơn như các thao tác tiền khác; tăng version. Cùng khóa thao tác, cùng người và nội dung trả lại kết quả đã lưu (không ghi lần hai); cùng khóa khác nội dung trả 409. Sai số tiền, đã có bản ghi, sai trạng thái hoặc version cũ trả 409; thiếu xác nhận, sai phương thức, chuyển khoản không tham chiếu, số tiền lẻ/âm trả 400; sai vai trò/chi nhánh trả 403.

Đơn áp dụng có thêm `rentalBalance` trong GET danh sách/chi tiết và phản hồi thao tác: `policy`, `dueAmount`, `status` (`DUE` chưa ghi nhận, `RECORDED` đã ghi nhận, `NOT_DUE` không còn phải thu), `demo`, `recorded` {`amount`, `method`, `reference`, `recordedAt`}. Staff/Admin nhận thêm `recordedByName` và `history` (ghi nhận/đảo: số tiền, phương thức, tham chiếu, tên người, thời điểm, lý do). Khách chỉ nhận phần chung, không có danh tính nhân viên hay nhật ký. Đơn không áp dụng không có trường này. Báo giá của đơn mới cũng có `rentalBalance` để hiển thị khoản sẽ thu tại chi nhánh.

## Lưu trữ

V14 thêm cột nullable vào `bookings` (không thêm bảng, vẫn 30 bảng kể cả lịch sử Flyway; thêm 1 FK, tổng 51): phiên bản chính sách, bản ghi hiện hành (số tiền, phương thức, tham chiếu, người ghi, tên, thời điểm, khóa thao tác, chế độ DEMO) và `rental_balance_log` (JSON) giữ mọi lần ghi nhận và bản bị đảo kèm người đảo, lý do, thời điểm. CHECK bảo đảm bản ghi đầy đủ hoặc rỗng, số tiền dương, phương thức hợp lệ, chuyển khoản có tham chiếu và chỉ đơn có phiên bản mới có bản ghi/nhật ký. Không backfill đơn cũ; không sửa V1–V13.

Hóa đơn phát hành khi hoàn tất sao chép bản ghi vào snapshot `rentalBalance` kèm ghi chú mô phỏng.

## Giao diện desktop

Chi tiết đơn có khối **Phần tiền thuê còn lại**: số còn lại và cách tính, trạng thái, nhãn mô phỏng. Staff chi nhánh nhận thấy form ghi nhận (số tiền khóa theo backend, phương thức, tham chiếu, ô xác nhận); Admin thấy form đảo có lý do. Khi chọn Bàn giao xe mà chưa ghi nhận, nút bị khóa kèm lý do. Lỗi mạng không rõ kết quả: đọc lại đơn trước; gửi lại dùng đúng khóa thao tác cũ, không tạo bản ghi thứ hai. Khách thấy khoản cần thanh toán tại chi nhánh nhận trước khi nhận xe và khoản đã ghi nhận.
