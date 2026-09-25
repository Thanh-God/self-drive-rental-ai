# Ranh giới module và quyền truy cập

## Backend

Package gốc: `com.carrental`. Một module là một phần mã nghiệp vụ, không tương ứng bắt buộc với một bảng hoặc một role.

| Module | Sở hữu/trách nhiệm | Phụ thuộc được phép ở mức service/adapter |
|---|---|---|
| `auth` | Đăng nhập, vòng đời phiên/token theo chính sách sẽ chốt | `user`; hạ tầng security |
| `user` | Tài khoản, hồ sơ, trạng thái và role USER/STAFF/ADMIN | Không phụ thuộc booking/AI |
| `vehicle` | Xe, hãng, loại, tiện nghi, ảnh, giá hiện hành, trạng thái khai thác | `branch` để kiểm tra chi nhánh |
| `branch` | Chi nhánh giao/nhận của doanh nghiệp | Không dùng catalog tham quan làm dữ liệu chi nhánh |
| `location` | Catalog tham quan, tọa độ, phân loại, tham chiếu nhà cung cấp nếu có | Map adapter khi cần xác thực tọa độ |
| `booking` | Đơn, khoảng thuê, availability, giá snapshot, hủy và state transition | `user`, `vehicle`, `branch` |
| `operation` | Hồ sơ giao/nhận và điều phối nghiệp vụ vận hành | `booking`, `vehicle`; sau khi chốt thời điểm có thể gọi `contract`/`invoice` |
| `contract` | Hồ sơ hợp đồng và snapshot | `booking` để kiểm tra/trích xuất dữ liệu cần thiết |
| `invoice` | Hồ sơ hóa đơn và snapshot, không thanh toán online | `booking` để kiểm tra/trích xuất dữ liệu cần thiết |
| `review` | Đánh giá và trạng thái kiểm duyệt | `booking` kiểm tra chủ đơn, xe và điều kiện hoàn tất |
| `ai/recommendation` | Criteria, hard-filter, điểm và giải thích | `vehicle`, `booking`, Gemini adapter |
| `ai/itinerary` | Kế hoạch cá nhân và các mục lịch trình | `location`, Gemini adapter, Map adapter |

`security`, `config`, `exception` là hạ tầng chung. Kiểm tra chủ sở hữu tài nguyên vẫn nằm ở service nghiệp vụ. Không thêm repository/entity cho recommendation nếu chưa có yêu cầu lưu lịch sử.

Quy ước chống phụ thuộc vòng: `vehicle` không gọi `booking` để tính availability; `booking` kết hợp trạng thái xe với lịch thuê. `booking` không gọi ngược `operation`; `operation` điều phối giao/nhận. Nếu hợp đồng được tạo khi xác nhận đơn, `contract` có thể điều phối gọi `booking` rồi tạo snapshot trong cùng transaction; không đồng thời cho booking gọi ngược contract. Luồng cụ thể phải khớp chính sách phát hành được chốt sau.

## Staff/Admin là quyền, không là module dữ liệu

Không có module backend `staff` hoặc `admin`. Controller cho thao tác quản trị/nhân viên đặt trong module sở hữu nghiệp vụ: quản lý Staff ở `user`, xác nhận đơn ở `booking`, biên bản ở `operation`, kiểm duyệt ở `review`. Role vẫn giữ nguyên; bỏ thư mục không làm mất chức năng.

| Nhóm hành động | Guest | User | Staff | Admin |
|---|---|---|---|---|
| Catalog công khai | Xem | Xem | Xem | Xem |
| Tài khoản/hồ sơ | Đăng ký/đăng nhập | Hồ sơ mình | Hồ sơ mình theo quyền | Quản lý User/Staff, không xem mật khẩu rõ |
| Đặt xe | Không | Cho mình | Không đặt thay mặc định | Không đặt thay mặc định |
| Đơn/hợp đồng/hóa đơn | Không | Của mình | Dữ liệu cần cho vận hành | Tra cứu toàn hệ thống |
| Hủy đơn | Không | Của mình theo chính sách | Hỗ trợ theo quyền | Can thiệp theo quyền |
| Xác nhận/giao/nhận | Không | Không | Nghiệp vụ chính | Ngoại lệ được quy định rõ |
| Trạng thái xe | Không | Không | Cập nhật vận hành | Quản lý khai thác/catalog |
| Catalog/chi nhánh/địa điểm | Không sửa | Không sửa | Không quản lý danh mục | Quản lý |
| Đánh giá | Xem công khai | Gửi khi đủ điều kiện | Không kiểm duyệt mặc định | Kiểm duyệt |
| AI | Preview còn mở | Dùng và lưu hành trình mình | Không phải nghiệp vụ chính | Kiểm tra theo quyền được cấp |

Quyền Admin can thiệp không bỏ qua state machine. Danh sách thao tác và yêu cầu ghi lý do còn cần chốt. Việc một người biết URL Staff/Admin không cấp cho họ quyền tương ứng.

## Frontend

- `pages/guest`: đăng nhập, đăng ký; `pages/shared`: trang công khai dùng chung như danh sách/chi tiết xe.
- `pages/user`: hồ sơ, đặt xe, đơn của mình, hành trình; `pages/staff`: hàng đợi, xử lý đơn, giao nhận; `pages/admin`: tài khoản và catalog/kiểm duyệt.
- `components`: khối giao diện tái sử dụng; `inspection` phục vụ giao nhận, không là dịch vụ nghiệp vụ riêng.
- `api`: HTTP client chung và hàm gọi API theo nghiệp vụ; không gọi Gemini/Map trực tiếp, không tính giá có thẩm quyền.
- `hooks`: tải dữ liệu và logic giao diện dùng lại; `context`: phiên đăng nhập/trạng thái dùng chung nhỏ, không chứa bản sao toàn bộ database.
- `routes`: cấu hình route và guard; `layouts`: bố cục từng khu vực; `utils`: tiện ích thuần. Các trang thể hiện rõ loading, empty, lỗi, thành công.

Chưa thêm Redux hoặc hệ thống state management lớn; chọn theo nhu cầu thực tế. Chưa viết component React ở Giai đoạn 2.
