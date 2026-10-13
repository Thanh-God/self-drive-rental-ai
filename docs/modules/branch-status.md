# Trạng thái chi nhánh — C11-A1

ADMIN gọi `PUT /api/v1/admin/branches/{id}/status`:

```json
{"status":"INACTIVE","expectedVersion":0}
```

`status` bắt buộc ACTIVE hoặc INACTIVE, phân biệt hoa/thường. `expectedVersion` bắt buộc, không âm, lấy từ trường `version` của chi nhánh đang hiển thị. Response200 gồm `id,name,address,status,version`; lần đổi trạng thái tăng version theo Hibernate. Gửi lại cùng trạng thái với version hiện tại là no-op, không tăng version; version cũ luôn409, kể cả khi trạng thái yêu cầu đã giống hiện tại. Client tải bản mới trước khi thử lại.

Validation400, chi nhánh không tồn tại404, Guest401, USER/STAFF403. Service kiểm ADMIN, khóa record hiện có rồi so version trước ghi; không có giới hạn số chi nhánh ACTIVE tối thiểu. Chi nhánh mới ACTIVE; sửa tên/địa chỉ giữ trạng thái và dùng contract version hiện có.

Người dùng duyệt13/10/2026: giữ xe/vị trí, tuyến/fee/enabled, phân công Staff, đơn cũ và snapshot. Không tự điều chuyển, hủy đơn hoặc xóa dữ liệu khi đóng/mở. Không thêm bảng/migration; Flyway V1/V2 giữ nguyên. GET `/api/v1/branches` tiếp tục trả cả chi nhánh INACTIVE để client hiển thị đúng trạng thái.

A1 chỉ triển khai API, version và bảo toàn dữ liệu. Quy định chặn quote/đơn mới nhưng tiếp tục đơn cũ đã được duyệt; race đóng–tạo đơn và các bước xử lý đơn cũ cần kiểm chứng trong A2. Giao diện đóng/mở thuộc A3; browser E2E toàn luồng thuộc A4. Không suy toàn C11 DONE từ A1.

Test: `BranchStatusHttpServerTest` gọi HTTP server thực với SQL readback. [Runner MySQL](../../scripts/coordination/c11-branch-status/README.md) dùng fixture riêng; không test ghi DB gốc33385/3306. Evidence lượt A1 ở `.runtime/coordination-c11-a1-codexa-20261013/`.

## C11-A2 — kiểm trạng thái khi báo giá/tạo đơn

Quote và create đều dùng BookingRoute DTO (pickupName,returnName,fee) từ BranchService dưới transaction MANDATORY của BookingService. Service khóa từng chi nhánh nhận/trả theo thứ tự ID cố định, loại trùng; xác minh ACTIVE rồi lấy tên/phí. Khóa giữ tới commit quote/create. Close/status dùng cùng row lock: close commit trước thì quote/create409 đúng cause và không ghi booking/history; create giữ khóa trước thì close chờ commit, booking trở thành đơn cũ được phép xử lý. Báo giá cũ không cấp quyền tạo đơn sau khi đóng; create kiểm lại status/fee/schedule/GPLX.

Đơn đã tồn tại không kiểm ACTIVE chi nhánh khi CONFIRMED. Quyền Staff theo chi nhánh đã lưu, state/version, lịch/xe/GPLX vẫn kiểm như trước; Admin không được kế thừa thao tác Staff. Giao/nhận/hoàn tất vẫn kiểm thời điểm, kiểm GPLX thực tế, chi nhánh phân công và state machine. Return cập nhật vị trí xe theo nghiệp vụ, không phải side effect của close. Contract/invoice giữ tên/giá snapshot đã lưu trong booking, không viết lại khi đổi trạng thái/tên chi nhánh.

Kiểm chứng A2:6MySQL tests gồm HTTP quote/create pickup/return closed/no-write/stale quote, workflow qua4bước sau đóng/rename, actor/GPLX/xe/thời điểm/version negatives, disabled route/missingbranch và2race với actual MySQL data_lock_waits. RegressionA1 thêm4tests, tổng10/10noSKIP. [Runner A2](../../scripts/coordination/c11-branch-booking/README.md), evidence `.runtime/coordination-c11-a2-codexa-20261013/`. A3UI/A4browserE2E vẫn chưa triển khai.
## C11-A3 — giao diện ADMIN
Mỗi card có trạng thái/version và Ngừng/Mở nhận đơn mới. Chỉ gửi status/expectedVersion từ bản đã đọc; pending chặn thao tác trùng.400 không giả success;409 buộc tải lại trước retry, bỏ selection cũ để không tái dùng version lỗi. Sửa tên/địa chỉ giữ status. Mọi trạng thái vẫn có trong màn hình tuyến; đóng không tự disable tuyến hoặc phân công Staff. Không tự thêm minimum ACTIVE. Frontend tests99/99/lint/demoAPIbuild; A4 còn gatebrowser/SQL cuối.
