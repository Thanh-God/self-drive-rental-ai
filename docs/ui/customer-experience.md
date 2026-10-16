# Giao diện khách hàng và tích hợp API

React/Vite SPA dùng React Router, API client tập trung và layout Guest/User/Staff/Admin. Xem [frontend](../../frontend/README.md), [phạm vi](../requirements/system-scope.md) và [ranh giới module](../architecture/module-boundaries.md).

## Dữ liệu và thao tác

API mode lấy dữ liệu backend/MySQL, demo có model/session riêng và được nhận diện rõ. Lỗi API phải hiển thị lỗi/thử lại, không thay bằng dữ liệu mẫu. Backend kiểm tra quyền, chủ sở hữu, chi nhánh, trạng thái, lịch và giá. Admin không kế thừa giao nhận của Staff; AI/Map chưa tích hợp.

Giao diện có loading/error/empty/pending, chặn gửi lặp và phản hồi cũ. Stale version/revision cần tải lại trước khi gửi tiếp. Quote gắn với input; đổi xe, thời gian hoặc chi nhánh làm quote cũ hết hiệu lực. VND nguyên đồng, thời gian Asia/Ho_Chi_Minh; hóa đơn không chứng minh đã thanh toán. Thông tin [so sánh](vehicle-comparison.md), [yêu thích](vehicle-favorites.md) và [hướng dẫn thuê](rental-guide.md) có contract riêng.

## Tài khoản và hồ sơ

Đăng ký gồm họ tên, email, mật khẩu và tạo role USER. Email chuẩn hóa/kiểm trùng tại backend. Mật khẩu mới ít nhất 8 ký tự, có hoa/thường/số/ký tự đặc biệt, tối đa 72 byte UTF-8 và không thuộc danh sách phổ biến; tài khoản cũ giữ mật khẩu hiện có. Form có autocomplete, hiện/ẩn mật khẩu và giới hạn gửi request.

Hồ sơ sửa họ tên, số điện thoại và GPLX; email chỉ đọc. Điện thoại 7–15 chữ số, có thể bắt đầu bằng +; đây là kiểm tra định dạng, không xác minh sở hữu số. GPLX theo hệ/hạng/hộp số, còn hạn đến hết thuê; Staff đối chiếu bản gốc trước giao.

Đổi mật khẩu cần mật khẩu hiện tại, mật khẩu mới và xác nhận. Thành công mới xóa phiên local, thu hồi token cũ và yêu cầu đăng nhập lại. Đăng xuất xóa phiên thiết bị ngay, đồng thời gọi API thu hồi; lỗi mạng phải cảnh báo chưa xác nhận thu hồi phía server. Đăng nhập tiếp theo chờ request đăng xuất cũ kết thúc. Không tự gửi lại thao tác ghi khi timeout; tải lại thông tin để kiểm tra kết quả. Email verification/OTP/SMS/Google OAuth chưa tích hợp.

## Danh mục và thương hiệu

Trang chủ/danh sách API có thanh hãng lấy từ xe thật và catalog, chỉ hiện hãng có xe; tối đa 7 hãng và phần còn lại trong Khác. Tất cả xe bỏ lọc hãng; chọn hãng dùng `/vehicles?brand=<brandId>` và kết hợp tên/loại/chỗ/hộp số/chuyến. Trạng thái xe không còn là bộ lọc công khai. Thiếu dữ liệu hoặc lỗi chỉ có Tất cả xe, không tạo hãng giả. Màn hình hẹp cuộn ngang; thanh hãng có tên truy cập, aria-current và focus rõ.

## Độ rõ và khả năng truy cập

Token màu/shadow nằm tại `frontend/src/index.css`. Nền trang `--color-page-background`, thẻ trắng `--color-surface`, nút chính cam/chữ tối, nút phụ trắng/viền rõ trong nội dung khách hàng. Chữ phụ dùng `--color-readable-muted`, viền điều khiển dùng `--color-secondary-border`; không thêm màu cứng trong component. Footer nền tối giữ màu chữ riêng.

Form có label/focus rõ, thao tác bàn phím và thông báo dễ hiểu. Chữ thông thường đặt mục tiêu tương phản tối thiểu 4.5:1, biên điều khiển 3:1 so với nền liền kề; đây là tiêu chí từng cặp màu, không tự chứng nhận toàn site đạt WCAG. Responsive web, không phát triển app mobile riêng. Kiểm tra bằng npm test/lint, build API/demo và browser với DB test cô lập; không test ghi trên dữ liệu vận hành.
