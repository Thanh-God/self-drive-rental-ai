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
