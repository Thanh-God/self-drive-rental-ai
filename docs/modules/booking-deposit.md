# Cọc giữ chỗ — VNPAY Sandbox

Chỉ thử nghiệm sandbox, không thu tiền thật. Chưa có merchant giữ `DEPOSIT_ENABLED=false`. URL VNPAY cố định ở sandbox, không tự chuyển production.

## Quy tắc

Đơn mới khi cờ bật lưu snapshot `sandbox-deposit-30-v1`: cọc 30% tiền thuê làm tròn lên VND nguyên, không tính phí tuyến. Cọc tính vào tiền thuê, không là cọc thiệt hại. Đơn cũ không yêu cầu cọc. Hóa đơn vẫn thể hiện giá trị dịch vụ, không chứng minh đã thu đủ tiền.

PENDING gồm chờ kiểm tra hồ sơ/chờ đóng cọc. Staff chi nhánh nhận duyệt ảnh GPLX và yêu cầu cọc. Hạn là mốc sớm hơn giữa duyệt +30 phút và hạn giữ lịch hiện có; duyệt lại không kéo dài. Backend kiểm lại GPLX, lịch, xe và hạn trước khi tự CONFIRMED, phát hành một hợp đồng. Không xác nhận thủ công đơn yêu cầu cọc. Đối chiếu bản gốc và bàn giao giữ nguyên.

Return URL chỉ hiển thị; IPN hoặc truy vấn có chữ ký mới ghi nhận tiền. Mỗi giao dịch có tham chiếu riêng. Kết quả chưa rõ phải đối soát trước khi thay thế. Ghi nhận tiền tách khỏi xác nhận đơn để tiền đến muộn/không đủ điều kiện vẫn được đưa vào hoàn, không giành lại lịch.

## Hủy và hoàn

- Chưa thu tiền: không hoàn.
- Doanh nghiệp từ chối/không cung cấp xe, khách hủy trước mốc nhận ít nhất 24 giờ: hoàn toàn bộ. Đơn theo ngày dùng đầu ngày nhận.
- Hủy sát giờ hoặc không đến nhận: Admin quyết định 0–100%, bắt buộc lý do.
- Tiền đến muộn, đơn không xác nhận được hoặc thu thừa: hoàn toàn bộ khoản không áp dụng.
- No-show: sau hết ngày nhận, Staff chi nhánh nhận xác nhận đã liên hệ và chưa giao xe, ghi lý do, kiểm tra chuỗi lịch trước hủy. Không áp dụng cho đơn đã giao/có biên bản giao.

Hoàn có vòng đời REQUESTED → APPROVED → PROCESSING → SUCCEEDED/FAILED/UNKNOWN; quyết định 0 đồng là DECLINED. Gửi yêu cầu thành công chưa là đã hoàn. Timeout giữ UNKNOWN, không gửi lại mù quáng. Tổng hoàn thành công và đang xử lý không vượt tiền thu. Không tự trừ thiệt hại/phụ phí.

## Cấu hình

V6 thêm payment_transactions, payment_refunds, payment_events; tổng 29 bảng gồm Flyway history. Không sửa migration cũ. Biến môi trường backend: DEPOSIT_ENABLED, VNPAY_TMN_CODE, VNPAY_HASH_SECRET, VNPAY_RETURN_URL. Spring không tự đọc .env.local. Không đưa secret vào Git/log/frontend.

Tắt nhận thanh toán mới vẫn xử lý IPN/đối soát/hoàn cũ. HTTPS tunnel chỉ chuyển endpoint IPN, không mở DB/Admin. Chưa có merchant không nghiệm thu tích hợp sandbox thật; kiểm thử giao thức nội bộ không thay thế kiểm thử nhà cung cấp.

Nguồn: [thanh toán](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html), [truy vấn/hoàn](https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr%26refund.html), [FAQ](https://sandbox.vnpayment.vn/apis/docs/faqs/).
