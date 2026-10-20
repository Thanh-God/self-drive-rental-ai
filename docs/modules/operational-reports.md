# Báo cáo vận hành Admin

Admin xem báo cáo tại `/admin` trong chế độ API. Các chỉ số lấy từ database; không sử dụng dữ liệu demo khi API lỗi.

## Chỉ số

| Trường DTO | Nhãn UI | Nguồn/công thức | Điều kiện thời gian/trạng thái |
|---|---|---|---|
| createdBookings.total | Đơn tạo trong khoảng | COUNT bookings | created_at >= fromInclusive AND created_at < toExclusive; tất cả trạng thái |
| createdBookings.byStatus | Trạng thái hiện tại của các đơn tạo trong khoảng | GROUP theo trạng thái effective | Cùng tập createdBookings; PENDING/expires_at <= asOf tính EXPIRED, còn lại status lưu DB |
| completedBookings | Đơn hoàn tất trong khoảng | COUNT booking_id có mốc COMPLETED đầu tiên thuộc khoảng | MIN occurred_at của next_status=COMPLETED theo booking_id, áp dụng biên trên mốc MIN; không lọc created_at, không suy từ status hiện tại |
| issuedInvoices | Hóa đơn phát hành trong khoảng | COUNT invoices | issued_at >= fromInclusive AND issued_at < toExclusive |
| invoiceTotalVnd | Tổng giá trị hóa đơn trong khoảng | COALESCE SUM invoices.total,0 | Cùng tập issuedInvoices; gồm tiền thuê/phí tuyến hiện có trong snapshot, không phải tiền thu/cọc/bồi thường |

Bộ4chỉ số card: createdBookings.total, completedBookings, issuedInvoices, invoiceTotalVnd; byStatus là bảng phân rã card đơn tạo, không một bộ KPI bổ sung. 8 keys trả đầy đủ, kể cả0: PENDING, CONFIRMED, IN_PROGRESS, RETURNED, COMPLETED, CANCELLED, REJECTED, EXPIRED. Tổng byStatus = createdBookings.total.

Trạng thái effective là hiện tại tại lần đọc, không lịch sử tại ngày cuối khoảng. Vì vậy báo cáo cùng tháng trước có thể đổi nhóm trạng thái khi đơn được xử lý sau đó; UI phải ghi rõ. PENDING hết hạn được đếm như EXPIRED kể cả DB chưa đổi status; không expire/write DB khi xem báo cáo.

Đơn tạo ngoài khoảng nhưng hoàn tất trong khoảng vẫn tăng completedBookings; đơn tạo trong khoảng nhưng hoàn tất ngoài khoảng chỉ tăng card tạo. Hóa đơn và mốc COMPLETED là nguồn riêng; không ép2count bằng nhau để che dữ liệu thiếu. Không có history COMPLETED thì không tự suy mốc từ hóa đơn; chưa hỗ trợ backfill. MIN tránh đếm trùng nếu dữ liệu lịch sử có nhiều sự kiện COMPLETED; không sửa dữ liệu đó. Đây là thống kê vận hành, không báo cáo kiểm toán tài chính hay thanh toán.

## Ngày, quyền và API

Endpoint: GET /api/v1/admin/reports/operations?from=2026-10-12&to=2026-10-12.

from/to là ngày ISO YYYY-MM-DD bắt buộc, duy nhất mỗi tham số; cả hai inclusive trên giao diện. Server cố định Asia/Ho_Chi_Minh, dùng LocalDate.atStartOfDay(zone); fromInclusive là đầu ngày from, toExclusive đầu ngày to+1 chuyển UTC. Không nhận giờ offset hoặc timezone tùy ý. Số ngày inclusive = DAYS.between(from,to)+1, 1..366; from=to hợp lệ. Lỗi400 nếu thiếu/rỗng/sai ngày thực tế/from>to/>366/ngày không chuyển được sang khoảng timestamp an toàn; server phải validate trước truy vấn. Miền ngày kỹ thuật cho các ngày Việt Nam trọn vẹn: 1970-01-02..2038-01-18. V1 dùng TIMESTAMP, nên không nhận miền DATETIME đến9999. [MySQL8.4 conversion documentation](https://dev.mysql.com/doc/refman/8.4/en/date-and-time-type-conversion.html) giới hạn TIMESTAMP tới19/01/2038UTC; hai biên ngày trên giữ cả fromInclusive/toExclusive trong miền an toàn. Miền ngày này không yêu cầu thay đổi schema. Không tự nhận tham số chi nhánh hoặc status để làm thay đổi contract. Ngày tương lai không bị coi là dữ liệu giả: báo cáo chỉ trả những bản ghi có thật; một khoảng chưa có dữ liệu trả0.

Mặc định UI: ngày1 tới ngày cuối tháng hiện tại theo Clock ngày Việt Nam (không rolling30days); cả hai tham số vẫn gửi rõ. Backend không tự thay thiếu params bằng ngày mặc định. MAX366đủ năm nhuận; không phải366*24h hardcode cho mọi timezone (zone hiện tại cố định).

Guest401, USER/STAFF403, ADMIN200; bảo vệ cả SecurityConfig /admin/** và service Actor.require(ADMIN). Đây là quyền báo cáo, không cấp Admin quyền giao nhận Staff. Không trả ID khách, email/điện thoại/GPLX/snapshot hoặc token. API chỉ đọc không tạo history/hóa đơn, không seed, không cleanup/repair.

Ví dụ response:

```json
{
  "fromDate": "2026-10-12",
  "toDate": "2026-10-12",
  "timeZone": "Asia/Ho_Chi_Minh",
  "fromInclusive": "2026-10-11T17:00:00Z",
  "toExclusive": "2026-10-12T17:00:00Z",
  "asOf": "2026-10-13T00:00:00Z",
  "createdBookings": {
    "total": 4,
    "byStatus": {"PENDING":0,"CONFIRMED":0,"IN_PROGRESS":0,"RETURNED":1,"COMPLETED":1,"CANCELLED":1,"REJECTED":0,"EXPIRED":1}
  },
  "completedBookings": 2,
  "issuedInvoices": 2,
  "invoiceTotalVnd": "1150000"
}
```

asOf là Clock.instant chụp một lần dùng tính expiresAt trong tất cả nhóm; không phải assertion thời điểm database snapshot chính xác. Service báo cáo điều phối các aggregation trong một read-only transaction MySQL REPEATABLE_READ để cùng snapshot committed; không PESSIMISTIC_WRITE/khóa vận hành. Các phép tổng hợp dùng cùng snapshot giao dịch; frontend không ghép nhiều response thành một snapshot.

Counts là số nguyên không âm, money là chuỗi chữ số thập phân VND nguyên đồng để không mất chính xác JavaScript >2^53; SQL SUM BIGINT có thể trả DECIMAL nên không ép thành long/truncate. Không currency conversion, float/round lại hoặc phân tách doanh thu thuê/phí bằng giá hiện tại. Dữ liệu rỗng trả tất cả counts0, byStatus đủ8keys0, invoiceTotalVnd="0"; lỗi500/kết nối không đổi thành0. Không trả tỷ lệ tăng trưởng hoặc so sánh kỳ trước.


## Giao diện

Mặc định tháng hiện tại theo giờ Việt Nam. Chọn Từ ngày/Đến ngày rồi Xem báo cáo; Làm mới tải lại khoảng đang xem. Giao diện hiển thị trạng thái tải, lỗi và Thử tải lại; khoảng rỗng hiển thị0. Số tiền định dạng VND bằng BigInt để giữ chính xác.
