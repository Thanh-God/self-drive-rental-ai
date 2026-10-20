# Trạng thái chi nhánh

ADMIN gọi `PUT /api/v1/admin/branches/{id}/status`:

```json
{"status":"INACTIVE","expectedVersion":0}
```

`status` bắt buộc ACTIVE hoặc INACTIVE, phân biệt hoa/thường. `expectedVersion` bắt buộc, không âm, lấy từ trường `version` của chi nhánh đang hiển thị. Response200 gồm `id,name,address,status,version`; lần đổi trạng thái tăng version theo Hibernate. Gửi lại cùng trạng thái với version hiện tại là no-op, không tăng version; version cũ luôn409, kể cả khi trạng thái yêu cầu đã giống hiện tại. Client tải bản mới trước khi thử lại.

Validation400, chi nhánh không tồn tại404, Guest401, USER/STAFF403. Service kiểm ADMIN, khóa record hiện có rồi so version trước ghi; không có giới hạn số chi nhánh ACTIVE tối thiểu. Chi nhánh mới ACTIVE; sửa tên/địa chỉ giữ trạng thái và dùng contract version hiện có.

Đóng/mở chi nhánh phải giữ xe/vị trí, tuyến/fee/enabled, phân công Staff, đơn cũ và snapshot. Không tự điều chuyển, hủy đơn hoặc xóa dữ liệu khi đóng/mở. Không thêm bảng/migration; Flyway V1/V2 giữ nguyên. GET `/api/v1/branches` tiếp tục trả cả chi nhánh INACTIVE để client hiển thị đúng trạng thái.

## Báo giá và đơn thuê

Quote và create đều dùng BookingRoute DTO (pickupName,returnName,fee) từ BranchService dưới transaction MANDATORY của BookingService. Service khóa từng chi nhánh nhận/trả theo thứ tự ID cố định, loại trùng; xác minh ACTIVE rồi lấy tên/phí. Khóa giữ tới commit quote/create. Close/status dùng cùng row lock: close commit trước thì quote/create409 đúng cause và không ghi booking/history; create giữ khóa trước thì close chờ commit, booking trở thành đơn cũ được phép xử lý. Báo giá cũ không cấp quyền tạo đơn sau khi đóng; create kiểm lại status/fee/schedule/GPLX.

Đơn đã tồn tại không kiểm ACTIVE chi nhánh khi CONFIRMED. Quyền Staff theo chi nhánh đã lưu, state/version, lịch/xe/GPLX vẫn kiểm như trước; Admin không được kế thừa thao tác Staff. Giao/nhận/hoàn tất vẫn kiểm thời điểm, kiểm GPLX thực tế, chi nhánh phân công và state machine. Return cập nhật vị trí xe theo nghiệp vụ, không phải side effect của close. Contract/invoice giữ tên/giá snapshot đã lưu trong booking, không viết lại khi đổi trạng thái/tên chi nhánh.


## Giao diện Admin

Admin đóng/mở nhận đơn mới tại màn hình Chi nhánh/Tuyến. Form gửi status/expectedVersion của bản đã đọc; trạng thái chờ ngăn gửi lặp. Lỗi400 giữ dữ liệu;409 yêu cầu tải bản mới trước khi thử lại. Tên, địa chỉ và trạng thái hiện hành luôn được đọc từ API.
