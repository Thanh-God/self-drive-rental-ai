# Giao diện và tích hợp API

React/Vite SPA dùng React Router và API client tập trung. Xem [hướng dẫn frontend](../../frontend/README.md), [phạm vi hệ thống](../requirements/system-scope.md) và [ranh giới module](../architecture/module-boundaries.md).

API mode dùng dữ liệu backend/MySQL; demo có model/session riêng và được đánh dấu rõ. Lỗi API phải hiển thị lỗi/thử lại, không thay bằng dữ liệu mẫu.

Guest xem xe; USER đăng ký/đăng nhập, xem hồ sơ/GPLX, báo giá/đơn và tài liệu thuê; STAFF xử lý đúng chi nhánh/phân công; ADMIN quản lý tài khoản/catalog/xe/chi nhánh/địa điểm/đánh giá và báo cáo vận hành. Backend có thẩm quyền về giá, lịch, quyền và trạng thái. AI/Map còn phụ thuộc phạm vi/provider được quyết định riêng.

Giao diện dùng layout chung và design tokens. Hiển thị loading/error/empty/pending, ngăn gửi lặp và phản hồi cũ; stale version/revision phải tải bản mới trước khi gửi lại. Quote gắn với input hiện tại, thay lịch/xe/chi nhánh làm quote cũ hết hiệu lực. Định dạng VND nguyên đồng và giờ Asia/Ho_Chi_Minh; dữ liệu hóa đơn không gắn nhãn đã thanh toán.

Trọng tâm là web desktop. Form có label/focus rõ, sử dụng bàn phím, thông báo lỗi dễ hiểu; không phát triển ứng dụng mobile riêng. Kiểm tra frontend bằng npm test/lint và build demo/API; browser tích hợp dùng database test cô lập. Không kiểm thử ghi vào dữ liệu vận hành.
