# Giai đoạn 1 — Phạm vi và yêu cầu hệ thống

**Đề tài:** Xây dựng hệ thống cho thuê xe tự lái tích hợp trí tuệ nhân tạo hỗ trợ lựa chọn phương tiện và lập kế hoạch hành trình cá nhân hóa  
**Phiên bản:** 0.1 — Bản phân tích khởi đầu  
**Phạm vi:** Khóa luận cá nhân, thời gian dự kiến khoảng 3 tháng

## 1. Mục tiêu

Xây dựng ứng dụng web mô phỏng doanh nghiệp cho thuê xe tự lái. Hệ thống hỗ trợ khách hàng tìm và đặt xe, nhân viên vận hành đơn thuê và quản trị viên quản lý dữ liệu. Hai chức năng AI trọng tâm là gợi ý phương tiện và lập kế hoạch hành trình cá nhân hóa.

## 2. Công nghệ và nguyên tắc kiến trúc

- Frontend: React.js.
- Backend: Java Spring Boot, REST API.
- Database: MySQL, truy cập bằng Spring Data JPA/Hibernate.
- Xác thực và phân quyền: Spring Security + JWT.
- AI: Gemini API, chỉ được gọi từ backend.
- Bản đồ: một Map API được gọi qua adapter phía backend.
- Ưu tiên modular monolith, có ranh giới module rõ ràng và phù hợp triển khai một cá nhân.

Backend là nguồn có thẩm quyền cho tài khoản, quyền, tình trạng xe, lịch thuê, giá, đơn hàng và dữ liệu địa điểm. Gemini không được truy cập database trực tiếp, không tự quyết định giá/availability và không tạo ID nghiệp vụ. Map API cung cấp dữ liệu vị trí/tuyến; backend xác thực và quản lý dữ liệu được lưu.

## 3. Actor và trách nhiệm

| Actor | Mô tả | Trách nhiệm chính |
|---|---|---|
| Guest | Người chưa đăng nhập | Duyệt, tìm kiếm, lọc xe; xem thông tin công khai; đăng ký và đăng nhập. Có thể thử chức năng AI theo chính sách sản phẩm. |
| User | Khách hàng đã đăng nhập | Quản lý hồ sơ; tạo/hủy đơn thuê của mình; xem lịch sử, hợp đồng và hóa đơn; sử dụng AI; gửi đánh giá đủ điều kiện. |
| Staff | Nhân viên vận hành | Xem và xử lý đơn; xác nhận/từ chối; bàn giao/nhận xe; cập nhật tình trạng vận hành và hoàn tất đơn. |
| Admin | Quản trị viên | Quản lý User/Staff, quyền, xe, hãng/loại xe, địa điểm; kiểm duyệt đánh giá; xem thống kê và trạng thái tích hợp. |

Guest là actor không xác thực, không phải role tài khoản. Role tài khoản dự kiến gồm `USER`, `STAFF`, `ADMIN`. Gemini và dịch vụ bản đồ là hệ thống bên ngoài, không tính là actor nghiệp vụ.

## 4. Phạm vi chức năng

### 4.1 Bắt buộc cho MVP

1. Đăng ký, đăng nhập, đăng xuất; quản lý hồ sơ cơ bản và phân quyền theo role.
2. Xem, tìm kiếm, lọc và xem chi tiết xe; hiển thị hình ảnh, giá, số chỗ, loại xe và tiện nghi.
3. Kiểm tra lịch khả dụng, tạo đơn thuê, xem đơn và hủy theo chính sách.
4. Staff xác nhận/từ chối đơn, ghi nhận bàn giao/nhận xe và hoàn tất đơn.
5. Tra cứu hợp đồng và hóa đơn gắn với đơn; chưa cần thanh toán online.
6. User gửi rating/nội dung sau khi đơn hoàn thành; Admin kiểm duyệt trạng thái hiển thị.
7. Recommendation: hard-filter xe bằng backend, chấm điểm/xếp hạng, Gemini hỗ trợ phân tích free text hoặc giải thích.
8. Itinerary: lấy candidate location và ước tính tuyến bằng Map API, Gemini lập lịch từ dữ liệu đã cung cấp, backend kiểm tra và lưu kế hoạch.
9. Admin quản lý tài khoản, dữ liệu xe, hãng/loại xe và địa điểm.

### 4.2 Nên có nếu còn thời gian

- Dashboard số liệu vận hành cơ bản.
- Thông báo trong ứng dụng khi trạng thái đơn đổi.
- Ghi chú/biên bản tình trạng xe lúc giao nhận.
- User chỉnh sửa hoặc xóa hành trình đã lưu.
- Tìm kiếm địa điểm theo loại hình.

### 4.3 Ngoài phạm vi bắt buộc

- Cổng thanh toán trực tuyến, hoàn tiền tự động.
- Thuê xe có tài xế.
- Bảo hiểm tự động, GPS/IoT, quản lý bảo dưỡng nâng cao.
- Huấn luyện LLM riêng hoặc hệ thống recommendation học từ dữ liệu lớn.
- Microservices, phân quyền permission tùy biến phức tạp.
- Email/SMS thương mại và báo cáo tài chính nâng cao.

## 5. Yêu cầu chức năng

| ID | Yêu cầu |
|---|---|
| FR-01 | Guest có thể đăng ký tài khoản bằng thông tin hợp lệ; email không được trùng. |
| FR-02 | Hệ thống xác thực thông tin đăng nhập và áp dụng quyền theo `USER`, `STAFF`, `ADMIN`. |
| FR-03 | User cập nhật hồ sơ và đổi mật khẩu; mật khẩu không được lưu dạng rõ. |
| FR-04 | Guest/User xem danh sách, tìm kiếm, lọc và xem chi tiết xe. |
| FR-05 | Hệ thống kiểm tra khả dụng xe theo khoảng thời gian trước và trong lúc tạo đơn. |
| FR-06 | User tạo đơn thuê; server tính số ngày, tiền thuê, tiền cọc (nếu có) và lưu snapshot giá. |
| FR-07 | User chỉ xem và thao tác trên đơn của mình; được hủy khi đáp ứng chính sách. |
| FR-08 | Staff xem đơn cần xử lý, xác nhận/từ chối và ghi nhận lý do khi từ chối. |
| FR-09 | Staff ghi nhận giao xe, nhận xe trả và cập nhật trạng thái đơn/tình trạng vận hành. |
| FR-10 | User và Staff tra cứu hồ sơ hợp đồng/hóa đơn theo quyền; Admin có thể tra cứu toàn hệ thống. |
| FR-11 | User gửi tối đa một đánh giá cho đơn đã hoàn tất; Admin có thể ẩn/hiện đánh giá. |
| FR-12 | Backend lọc các xe không hoạt động, không đủ điều kiện hoặc bị trùng lịch trước khi recommendation. |
| FR-13 | Backend chấm điểm và xếp hạng xe theo tiêu chí đầu vào; trả score breakdown. |
| FR-14 | Gemini hỗ trợ phân tích yêu cầu tự nhiên và/hoặc giải thích các xe backend đã xếp hạng. |
| FR-15 | Backend lấy địa điểm ứng viên và thông tin tuyến cần thiết từ Map API cho itinerary. |
| FR-16 | Gemini tạo lịch trình theo ngày từ constraint và candidate locations do backend cung cấp. |
| FR-17 | Backend kiểm tra itinerary, lưu và cho User xem lại kế hoạch. |
| FR-18 | Admin quản lý User/Staff, xe, hãng/loại xe, địa điểm và đánh giá. |
| FR-19 | Lỗi/timeout/quota từ Gemini hoặc Map API được xử lý có thông báo; không làm sai dữ liệu nghiệp vụ. |

## 6. Yêu cầu phi chức năng

| Nhóm | Tiêu chí |
|---|---|
| Bảo mật | Mật khẩu được hash; endpoint Staff/Admin được bảo vệ theo role; User không truy cập được đơn/hành trình của User khác. |
| Toàn vẹn | Backend tính giá và kiểm tra availability; frontend không phải nguồn xác thực các giá trị này. |
| Tin cậy AI | Mọi output AI được validate theo schema và ràng buộc nghiệp vụ trước khi hiển thị/lưu. |
| Tích hợp | Khi Gemini/Map không khả dụng, hệ thống trả lỗi/fallback minh bạch, không tạo dữ liệu giả. |
| Hiệu năng | Với dữ liệu demo, thao tác catalog thông thường mục tiêu phản hồi dưới 3 giây; tác vụ AI có timeout riêng và được đo trong môi trường demo. |
| Dễ bảo trì | Controller không giữ business logic; module nghiệp vụ và adapter ngoài được tách rõ. |
| Usability | Luồng tìm xe, đặt xe, xử lý đơn và AI có trạng thái loading, empty, lỗi và thành công rõ ràng. |
| Responsive | Các luồng chính sử dụng được trên trình duyệt desktop và màn hình di động phổ biến. |
| Triển khai | Có hướng dẫn cấu hình môi trường, migration, seed và chạy bản demo. |

## 7. Business rules sơ bộ

### Tài khoản và phân quyền

- Email được chuẩn hóa và duy nhất.
- Chỉ tài khoản `ACTIVE` được sử dụng chức năng cần đăng nhập.
- Staff xử lý vận hành; không được tự thay đổi role hoặc quản lý tài khoản Admin.
- Admin quản lý tài khoản User/Staff và danh mục hệ thống.
- Các thao tác phải kiểm tra quyền ở backend, bao gồm quyền sở hữu tài nguyên.

### Xe và đơn thuê

- Xe `MAINTENANCE` hoặc `INACTIVE` không thể đặt.
- `startAt < endAt`.
- Hai đơn chiếm lịch của cùng xe không được overlap. Điều kiện overlap: `newStart < existingEnd AND newEnd > existingStart`.
- Trạng thái chiếm lịch phải được chốt cùng state machine; dự kiến gồm đơn chờ xác nhận, đã xác nhận và đang thuê.
- Backend kiểm tra availability lại khi tạo đơn và có biện pháp chống hai yêu cầu đồng thời giữ cùng xe.
- Giá và tổng tiền do backend tính; giá tại thời điểm đặt được lưu thành snapshot.
- Không xóa cứng xe/tài khoản có dữ liệu giao dịch; dùng trạng thái ngừng hoạt động.

### Hủy, giao nhận và đánh giá

- User chỉ hủy đơn của mình và chỉ khi thỏa chính sách hủy.
- Chính sách đề xuất ban đầu: hủy miễn phí trước giờ nhận tối thiểu 24 giờ; đơn sát giờ nhận do Staff/Admin xử lý theo chính sách hiển thị.
- Staff ghi nhận giao/nhận xe; đơn chỉ hoàn tất sau khi xe được trả và được xử lý theo quy trình.
- Chỉ User có đơn hoàn tất được đánh giá xe tương ứng; mỗi đơn tối đa một đánh giá; rating từ 1 đến 5.
- Admin có thể ẩn đánh giá vi phạm nhưng không xóa lịch sử kiểm duyệt nếu sau này bật audit.

### AI và hành trình

- Xe không khả dụng trong khoảng yêu cầu không được hiển thị như xe có thể đặt.
- Score, giá và availability được backend quyết định; Gemini chỉ diễn đạt giải thích.
- Itinerary chỉ được tham chiếu candidate location đã được backend cung cấp/xác thực.
- Distance/duration từ Map API là ước tính, có thể thay đổi theo tuyến và điều kiện giao thông.
- Không lưu itinerary nếu kết quả không qua validation nghiệp vụ.

## 8. Giả định và điểm cần xác nhận ở giai đoạn sau

Các mục sau là giả định thiết kế ban đầu, cần được chốt trước khi triển khai nghiệp vụ tương ứng:

1. **Quyền dùng AI của Guest:** đề xuất cho Guest xem kết quả gợi ý/hành trình nhưng chỉ User mới lưu lịch sử.
2. **Giấy phép lái xe:** cần quyết định hệ thống có ghi nhận thông tin giấy phép và Staff xác minh thủ công hay chỉ mô phỏng bước kiểm tra tại quầy. Không lưu ảnh giấy tờ nếu chưa thực sự cần.
3. **Cách tính ngày thuê:** đề xuất tính theo block 24 giờ, phần lẻ tính thêm một ngày; cần công bố rõ trong UI.
4. **Giữ xe khi chờ xác nhận:** cần quyết định đơn `PENDING` có chiếm lịch ngay và hết hạn sau bao lâu.
5. **Hợp đồng/hóa đơn:** cần chốt thời điểm tạo, ví dụ sau khi Staff xác nhận; dữ liệu hồ sơ phải giữ snapshot cần thiết.
6. **Chi nhánh và điểm tham quan — đã chốt ở Giai đoạn 2:** tách module `branch` quản lý chi nhánh giao nhận và `location` quản lý địa điểm tham quan; demo một chi nhánh, nhận/trả cùng chi nhánh. Chưa mở rộng điều chuyển xe giữa chi nhánh.
7. **Hủy sát giờ:** đề xuất chuyển cho Staff/Admin xử lý thay vì tự tính phí tự động.
8. **Map provider:** chọn nhà cung cấp theo khả năng sử dụng, chi phí, coverage và điều kiện tài khoản trước Phase tích hợp.

## 9. Tiêu chí hoàn thành Giai đoạn 1

Kiến trúc tiếp nối đã được duyệt tại [Giai đoạn 2](../architecture/system-architecture.md). Danh sách quyết định và chính sách còn mở được theo dõi tại [sổ quyết định](../architecture/decisions.md); đặc biệt quyền AI của Guest vẫn chưa chốt. Công cụ phát triển thống nhất là VS Code cho Java và React, không thay đổi stack nghiệp vụ.

- Bốn actor và trách nhiệm không chồng lấn đáng kể.
- MVP và tính năng mở rộng được phân biệt.
- Có mã yêu cầu chức năng và yêu cầu phi chức năng.
- Có business rules đủ để làm cơ sở thiết kế database/workflow.
- Các giả định chưa chốt được liệt kê, không bị coi nhầm là quyết định cuối cùng.
- Không có yêu cầu AI cho phép Gemini thay backend quyết định dữ liệu hoặc nghiệp vụ.
