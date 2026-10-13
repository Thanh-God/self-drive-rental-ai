# C12-1 — contract báo cáo vận hành

Ngày 13/10/2026. **DONE contract; chưa có endpoint/UI báo cáo được triển khai.** Người dùng duyệt bộ4chỉ số, ngày Việt Nam tối đa366ngày, mặc định tháng hiện tại; chưa lọc chi nhánh/biểu đồ/tăng trưởng. Căn cứ [kế hoạch C12](../architecture/c12-plan.md), [quyết định](../architecture/decisions.md), UC-A05 trong [use cases](../requirements/use-cases.md).

## Khảo sát source và giới hạn

- Booking.java có createdAt/startAt/endAt/expiresAt/status; không có completedAt. V1 bookings.created_at TIMESTAMP(6), 8 trạng thái theo CHECK. BookingService.effective ánh xạ PENDING với expiresAt <= Clock.instant thành EXPIRED mà không cần ghi DB; view/list dùng effective. Không dùng thời gian nhận xe làm thời gian tạo đơn.
- booking_status_history có next_status/occurred_at/booking_id. BookingService.change ghi history sau chuyển hợp lệ; COMPLETED chỉ từ RETURNED. RentalWorkflow.apply @Transactional phát hành InvoiceService.issue khi COMPLETED trong cùng giao dịch. Mốc hoàn tất lấy lịch sử, không lấy end_at hoặc issued_at thay thế.
- invoices có booking_id UNIQUE, issued_at TIMESTAMP(6), total BIGINT không âm và snapshot; invoice_items là chi tiết. InvoiceService.issue lấy b.total ở thời điểm phát hành; không có paid_at/payment source. SUM dùng invoices.total, không join items gây nhân đôi và không tính lại theo giá xe hiện tại.
- Invoice.java/InvoiceRepository.java hiện là file rỗng placeholder; không xóa và không coi là entity/repository đã hoạt động. Persistence hóa đơn đang qua JdbcTemplate trong InvoiceService.
- /admin index hiện screen(DashboardPage) không có apiElement; DashboardPage export DashboardScreen trong ManagementScreens, lấy useDemo. C12-4 phải thêm trang API và truyền apiElement rõ; không dùng số demo làm báo cáo API.
- Không có endpoint báo cáo trong source đã khảo sát. Chỉ phát biểu tính toán đề xuất/contract, không tuyên bố backend/SQL/browser đã đạt.

## Chỉ số đã chốt

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

Endpoint dự kiến: GET /api/v1/admin/reports/operations?from=2026-10-12&to=2026-10-12. **Chưa triển khai.**

from/to là ngày ISO YYYY-MM-DD bắt buộc, duy nhất mỗi tham số; cả hai inclusive trên giao diện. Server cố định Asia/Ho_Chi_Minh, dùng LocalDate.atStartOfDay(zone); fromInclusive là đầu ngày from, toExclusive đầu ngày to+1 chuyển UTC. Không nhận giờ offset hoặc timezone tùy ý. Số ngày inclusive = DAYS.between(from,to)+1, 1..366; from=to hợp lệ. Lỗi400 nếu thiếu/rỗng/sai ngày thực tế/from>to/>366/ngày không chuyển được sang khoảng timestamp an toàn; server phải validate trước truy vấn. Miền ngày kỹ thuật cho các ngày Việt Nam trọn vẹn: 1970-01-02..2038-01-18. V1 dùng TIMESTAMP, nên không nhận miền DATETIME đến9999. [MySQL8.4 conversion documentation](https://dev.mysql.com/doc/refman/8.4/en/date-and-time-type-conversion.html) giới hạn TIMESTAMP tới19/01/2038UTC; hai biên ngày trên giữ cả fromInclusive/toExclusive trong miền an toàn. C12-3 phải kiểm biên nativeMySQL; không sửa schema để mở rộng trong lượt này. Không tự nhận tham số chi nhánh hoặc status để làm thay đổi contract. Ngày tương lai không bị coi là dữ liệu giả: báo cáo chỉ trả những bản ghi có thật; một khoảng chưa có dữ liệu trả0.

Mặc định UI: ngày1 tới ngày cuối tháng hiện tại theo Clock ngày Việt Nam (không rolling30days); cả hai tham số vẫn gửi rõ. Backend không tự thay thiếu params bằng ngày mặc định. MAX366đủ năm nhuận; không phải366*24h hardcode cho mọi timezone (zone hiện tại cố định).

Guest401, USER/STAFF403, ADMIN200; bảo vệ cả SecurityConfig /admin/** và service Actor.require(ADMIN). Đây là quyền báo cáo, không cấp Admin quyền giao nhận Staff. Không trả ID khách, email/điện thoại/GPLX/snapshot hoặc token. API chỉ đọc không tạo history/hóa đơn, không seed, không cleanup/repair.

Ví dụ JSON contract (số liệu dataset bên dưới):

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

asOf là Clock.instant chụp một lần dùng tính expiresAt trong tất cả nhóm; không phải assertion thời điểm database snapshot chính xác. C12-2 điều phối các aggregation trong một read-only transaction MySQL REPEATABLE_READ để cùng snapshot committed; không PESSIMISTIC_WRITE/khóa vận hành. C12-3 cần chứng minh tính nhất quán khi có giao dịch cập nhật song song hoặc báo blocker nếu DB/runtime không đáp ứng; không ghép nhiều response frontend rồi gọi một snapshot.

Counts là số nguyên không âm, money là chuỗi chữ số thập phân VND nguyên đồng để không mất chính xác JavaScript >2^53; SQL SUM BIGINT có thể trả DECIMAL nên không ép thành long/truncate. Không currency conversion, float/round lại hoặc phân tách doanh thu thuê/phí bằng giá hiện tại. Dữ liệu rỗng trả tất cả counts0, byStatus đủ8keys0, invoiceTotalVnd="0"; lỗi500/kết nối không đổi thành0. Không trả tỷ lệ tăng trưởng hoặc so sánh kỳ trước.

## Ranh giới triển khai C12-2

Entry point báo cáo thuộc operation (điều phối nghiệp vụ), không tạo module Admin/report hoặc bảng mới. Booking sở hữu truy vấn/projection aggregate created/effective/history completed qua typed API; invoice sở hữu query invoice count/sum qua typed API trong InvoiceService hoặc adapter nội bộ. operation gọi2service/DTO có kiểu trong cùng transaction; không raw SQL hoặc import entity mutable xuyên module. Không refactor InvoiceService JDBC hiện có ngoài phạm vi query mới. Chỉ query aggregate, không gọi BookingService.list/findAll để gom toàn bộ dữ liệu vào Java.

Dự kiến file: operation/controller/OperationalReportController.java, operation/service/OperationalReportService.java; booking aggregate DTO/method/repository query nội bộ; invoice aggregate DTO/method/adapter; tests tương ứng. C12-2 kiểm tên/structure thực trước sửa; không tạo file empty. Query bound parameters và lỗi date400. V1 hiện không có index chuyên báo cáo trên created_at/issued_at/history; C12-3 ghi plan/latency trên dữ liệu có kích thước rõ trước đề xuất index migration mới, không sửa V1.

## Dataset kỳ vọng độc lập cho biên ngày

Khoảng12/10/2026VN = [2026-10-11T17:00Z,2026-10-12T17:00Z), asOf=2026-10-13T00:00Z. Bảng là mô hình tài liệu, không khẳng định dữ liệu DB hiện có hoặc thay workflow bằng insert tay.

| ID giả | created_at UTC | status DB | expires_at nếu PENDING | Mốc COMPLETED đầu UTC | Hóa đơn issued_at UTC / total VND |
|---|---|---|---|---|---|
| A | 11/10 17:00:00 | PENDING | 11/10 19:00:00 | — | — |
| B | 12/10 00:00:00 | COMPLETED | — | 12/10 01:00:00 | 12/10 01:00:00 /650000 |
| C | 12/10 16:59:59.999999 | RETURNED | — | — | — |
| D | 12/10 12:00:00 | CANCELLED | — | — | — |
| E | 11/10 16:59:59.999999 | COMPLETED | — | 11/10 17:00:00 | 11/10 17:00:00 /500000 |
| F | 12/10 17:00:00 | CONFIRMED | — | — | — |
| G | 10/10 00:00:00 | COMPLETED | — | 12/10 17:00:00 | 12/10 17:00:00 /900000 |

Expected: created A/B/C/D=4, EXPIRED1/COMPLETED1/RETURNED1/CANCELLED1, các nhóm khác0; completed B/E=2; invoices B/E=2, sum650000+500000=1150000. F/G exact upper bị loại, A/E exact lower được nhận. History duplicate củaB không tăng completed; status/giá xe hiện tại không đổi số hóa đơn. Khoảng rỗng trả0.

## Ma trận nghiệm thu kế tiếp

- C12-2: thiếu/sai/đảo ngày, năm nhuận29/02, chính xác366 và367ngày, timezoneUTC conversion, quyền401/403/200; aggregates0/nhómđủ8/expiry equality và money >safeInteger. Không tính test skipped là PASS.
- C12-3: MySQL thật so expected/API/SQL, boundarymicrosecond, duplicatehistory MIN, đơn tạo ngoài nhưng hoàn tất trong, invoice snapshot vs giá xe thay, empty/no-write và transaction snapshot. Fixture riêng không ghi33385/3306; không giả workflow/hóa đơn PASS từ dữ liệu insert trực tiếp. Seed representative workflow có thời điểm kiểm soát bằng testClock phù hợp đã có, không sửa Clock production.
- C12-4/5: route /admin API tách demo, label metric/time/status rõ, default month đúngtimezone, dates validation, money định dạng giữ precision, pending/out-of-order/loading/error/zero/retry/RBAC. Browser thật phải đối chiếu API+SQL; frontend tests/lint/demo/APIbuild, backend verify cùng dependency gates.

## Quyết định mở và trạng thái

Metric/date scope đã duyệt; miền ngày kỹ thuật được giới hạn theo TIMESTAMP V1 và tài liệu MySQL8.4, chưa coi boundary nativeMySQL đã nghiệm thu. Chưa có quyết định index, export, trend, branchfilter, payment, AI, chart; giữ ngoài phạm vi. C12-1 chỉ nghiệm thu tài liệu/source/equations/link và ví dụ, không chạy test chức năng giả. C12-2–5 chưa bắt đầu. Lỗi timeout hồ sơ đang hoãn vẫn PARTIAL.

## C12-2 thực thi —13/10/2026 —PASS backend/H2 scoped

Đã triển khai GET /api/v1/admin/reports/operations?from=YYYY-MM-DD&to=YYYY-MM-DD theo DTO/metric/date/RBAC ở trên. operation điều phối transaction readonlyREPEATABLE_READ; booking/invoice giữ aggregate SQL nội bộ và DTO có kiểu. Không load toàn bảng/entity xuyên module, migration hoặc dependency mới. Query params ngoài from/to, lặp tham số hoặc miền ngày không hợp lệ400. Guest401/USER-STAFF403/ADMIN200. Tiền SUMDECIMAL trả string, không ép long.

Backend verify153reported/139executed/14skip,0failure/error. ReportIntegration4/4noskip chứng minh bằng Spring MockMvc/H2: validation/date/RBAC, empty/canonicaltimezone, effectiveexpired/currentgroups/firstcompletion/count/money/no-write, SUM lớn hơnLong vàJSsafeInteger. Rows test là fixture cho truy vấn, không chứng minh workflow đã chạy. MySQL native/snapshot/concurrency/performance và browser C12-3/5 chưa nghiệm thu.

Source được build trong runtimecopy mới; không ghi đè backend/target của tiến trình người dùng. Sourcecopy và JARcompiledresources hashmatch. Evidence .runtime/coordination-c12-2-20261013/. Không restart backend đang chạy; API mới chưa nạp vào tiến trình đó. Các dòng “chưa triển khai” trước section này là baseline C12-1. C12-3–5 tiếp theo; timeout hồ sơ vẫn hoãn.
