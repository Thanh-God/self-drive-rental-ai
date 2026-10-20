# Xóa danh mục và chi nhánh

Admin có thể xóa hãng xe, loại xe và tiện nghi chưa được xe sử dụng qua `DELETE /api/v1/admin/{vehicle-brands|vehicle-categories|amenities}/{id}?expectedRevision={revision}`. Revision bắt buộc lấy từ danh mục vừa đọc; định dạng SHA256 hiện có được giữ nguyên. Backend khóa record rồi kiểm revision, đếm liên kết và dùng khóa ngoại bảo vệ lần cuối khi có thao tác đồng thời. Danh mục có xe liên kết, kể cả xe ngừng khai thác, bị từ chối409. Tiện nghi đang được gán cũng bị chặn; không tự gỡ liên kết.

Xóa thành công204 khiến danh mục biến mất khỏi catalog, bộ lọc và lựa chọn trong form mới. Thao tác không xóa xe, không tự đổi hãng/loại của xe, không sửa đơn thuê hoặc chứng từ. Admin muốn bỏ danh mục đang dùng phải xử lý liên kết xe một cách tường minh trước; hệ thống không tự chuyển xe sang danh mục khác.

Admin có thể xóa chi nhánh chưa có dữ liệu tham chiếu bằng `DELETE /api/v1/admin/branches/{id}?expectedVersion={version}`. Version bắt buộc, không âm; stale409, missing404, validation400, Guest401, USER/STAFF403. Backend khóa chi nhánh, đối chiếu version và giữ toàn bộ ràng buộc khóa ngoại. Xe theo home/current branch, đơn cũ, biên bản, tuyến kể cả đã đóng và phân công nhân viên đều ngăn xóa. Không cascade; cần dừng hoạt động thì dùng **Ngừng nhận đơn mới**, giữ quyền xử lý đơn cũ.

Giao diện yêu cầu xác nhận tên trước xóa, chặn gửi lặp, chỉ báo thành công sau phản hồi server và tải lại danh sách. Khi chi nhánh bị xóa, lựa chọn tuyến không giữ mã chi nhánh đã mất. Xem thêm [trạng thái chi nhánh](branch-status.md) và [quản lý xe](vehicle-management.md). Không bổ sung migration hoặc thay chính sách lưu lịch sử.
