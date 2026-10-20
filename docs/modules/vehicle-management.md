# Quản lý xe

API `GET /api/v1/vehicles` trả xe theo `createdAt` giảm dần, sau đó ID giảm dần để ổn định khi trùng thời điểm. Ngày tạo do đồng hồ backend cấp khi Admin tạo xe; cập nhật không đổi ngày tạo. Xe có sẵn trước migration V3 có `createdAt=null`, xếp sau xe mới; không suy ngày tạo từ UUID hoặc lần chỉnh sửa.

Admin có thể xóa xe chưa có đơn thuê qua `DELETE /api/v1/admin/vehicles/{id}?version={version}`. Phiên bản bắt buộc, số nguyên không âm; máy chủ khóa xe và đối chiếu phiên bản. Thành công trả204; xe thiếu404, phiên bản cũ409, sai quyền401/403. Xóa liên kết ảnh/tiện nghi của xe trong cùng transaction, giữ catalog tiện nghi và không xóa file ảnh bên ngoài.

Khóa ngoại giữ mọi đơn thuê, kể cả đơn hủy hoặc hoàn tất. Xe đã có đơn hoặc dữ liệu tham chiếu bị từ chối409; các liên kết ảnh/tiện nghi được rollback. Để dừng nhận đơn mới, Admin chuyển xe sang `INACTIVE` (Ngừng khai thác). Thao tác này không xóa lịch sử đơn/chứng từ. Frontend yêu cầu xác nhận tên và biển số trước xóa, chỉ báo thành công sau phản hồi máy chủ; Staff không có nút hoặc quyền xóa.

Nhóm trạng thái/Chỉnh sửa/Xóa xe nằm ở hàng dưới của card. Tên chi nhánh được lấy từ catalog chi nhánh, thiếu tên thì hiển thị mã hiện có.
