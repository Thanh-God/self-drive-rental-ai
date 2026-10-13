# Catalog địa điểm tham quan

Module location độc lập với chi nhánh vận hành. ADMIN quản lý tại `/admin/locations` trong chế độ API; demo giữ trang riêng. USER/STAFF403, Guest401 với API quản trị; route frontend có ADMIN guard. Không tích hợp Map/AI, public catalog, DELETE hoặc upload trong phạm vi này.

API dưới `/api/v1/admin/location-categories`: GET danh sách, POST tạo201, PUT `/{id}` cập nhật200. Input tên trimmed, không rỗng, tối đa100ký tự; tên trùng409. View `id,name,revision`. PUT yêu cầu `expectedRevision`64hex của bản đọc gần nhất. Form sửa ánh xạ `revision` sang `expectedRevision`, không gửi field revision thay thế.

API dưới `/api/v1/admin/locations`: GET danh sách/`/{id}`, POST201, PUT `/{id}`200. Input gồm categoryId, tên≤200ký tự, latitude/longitude và ACTIVE/INACTIVE. Vĩ độ±90, kinh độ±180, tối đa7decimal;0,0 hợp lệ, không tự làm tròn input>7decimal. Category thiếu400; record thiếu404; validation400; stale409. INACTIVE vẫn được Admin đọc/sửa.

Revision SHA256 có length prefix UTF8 theo nội dung record; không thêm cột version hoặc migration. Update khóa pessimistic record rồi đối chiếu revision trước ghi. Category rename giữ FK location và tên hiển thị mới; categoryName không thuộc revision location. Backend giữ thẩm quyền; stale response không tạo success UI, chọn bản mới để phục hồi.

Schema dùng `location_categories`/`locations` đã có trong Flyway; không sửa V1/V2 hoặc bảng itinerary. Evidence tích hợp13/10/2026 tại `.runtime/coordination-c11-location-integrate-20261013/`:79frontend tests,6locationMySQL tests, HTTP race/no-write/SQL readback và22browser assertions desktop. Xem [runner](../../scripts/coordination/c11-location/README.md), [kế hoạch C11](../architecture/c11-plan.md). Kết quả scoped, C11-A và toàn hệ thống chưa được suy PASS từ module này.
