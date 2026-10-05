# Giai đoạn 1 — Actor và Use Case

> Cập nhật 29/09/2026: các use case là yêu cầu, không phải chứng nhận source hoàn tất. Quyết định đa chi nhánh/GPLX/sự cố/AI tại [sổ quyết định](../architecture/decisions.md), trạng thái thực tại [audit](../architecture/system-architecture.md). Gemini trong các luồng dưới là phương án ban đầu, provider/mô hình cuối chưa chốt.

## 1. Danh sách Use Case

| ID     | Use case                                    | Actor chính | Mức ưu tiên |
| ------ | ------------------------------------------- | ----------- | ----------- |
| UC-G01 | Duyệt, tìm kiếm và lọc xe                   | Guest, User | MVP         |
| UC-G02 | Xem chi tiết xe và đánh giá                 | Guest, User | MVP         |
| UC-G03 | Đăng ký/đăng nhập                           | Guest       | MVP         |
| UC-G04 | Nhận gợi ý xe                               | Guest/User  | MVP         |
| UC-U01 | Quản lý hồ sơ cá nhân                       | User        | MVP         |
| UC-U02 | Kiểm tra khả dụng và tạo đơn thuê           | User        | MVP         |
| UC-U03 | Xem lịch sử/chi tiết đơn, hợp đồng, hóa đơn | User        | MVP         |
| UC-U04 | Hủy đơn thuê                                | User        | MVP         |
| UC-U05 | Gửi đánh giá sau khi thuê                   | User        | MVP         |
| UC-U06 | Tạo và quản lý hành trình cá nhân           | User        | MVP         |
| UC-S01 | Xem hàng đợi và xử lý đơn thuê              | Staff       | MVP         |
| UC-S02 | Bàn giao xe cho khách                       | Staff       | MVP         |
| UC-S03 | Nhận xe trả và hoàn tất đơn                 | Staff       | MVP         |
| UC-S04 | Cập nhật/báo tình trạng vận hành xe         | Staff       | MVP         |
| UC-A01 | Quản lý User và Staff                       | Admin       | MVP         |
| UC-A02 | Quản lý xe, hãng, loại xe và tiện nghi      | Admin       | MVP         |
| UC-A03 | Quản lý địa điểm                            | Admin       | MVP         |
| UC-A04 | Kiểm duyệt đánh giá                         | Admin       | MVP         |
| UC-A05 | Xem thống kê và tình trạng tích hợp         | Admin       | Nên có      |
| UC-U07 | Khai báo GPLX, báo sự cố và phản hồi yêu cầu bồi thường | User | MVP |
| UC-S05 | Đánh giá sự cố và căn cứ trách nhiệm theo đơn được phân quyền | Staff | MVP |
| UC-A06 | Quản lý tuyến/phí/phân công Staff, duyệt yêu cầu bồi thường | Admin | MVP |

## 2. UC-U02 — Kiểm tra khả dụng và tạo đơn thuê

**Actor chính:** User  
**Actor phối hợp:** Staff  
**Tiền điều kiện:** User đăng nhập; xe đang được khai thác; khoảng thuê hợp lệ.

### Luồng chính

1. User khai báo GPLX, chọn xe, thời gian và chi nhánh nhận/trả trong tuyến được phép.
2. Hệ thống kiểm tra dữ liệu ngày giờ.
3. Backend tải dữ liệu xe và kiểm tra trạng thái khai thác.
4. Backend khóa xe, kiểm tra các đơn chiếm lịch và chuỗi chi nhánh; không giả định điều chuyển ngoài hệ thống.
5. Backend tính block 24 giờ và phí tuyến, lưu snapshot; không tự tính cọc/phụ phí chưa chốt.
6. Backend tạo đơn ở trạng thái chờ xử lý và lưu snapshot giá.
7. Hệ thống trả mã đơn và thông tin tổng kết cho User.
8. Staff xem đơn trong hàng đợi, kiểm tra và xác nhận hoặc từ chối.
9. Hệ thống thông báo trạng thái xử lý để User tra cứu.

### Luồng thay thế/lỗi

- 2a. Thời gian nhận không trước thời gian trả: từ chối với lỗi validation.
- 4a. Xe đã được đặt trùng lịch: không tạo đơn; yêu cầu chọn xe hoặc thời gian khác.
- 4b. Có yêu cầu đồng thời tạo đơn cho cùng xe: chỉ một yêu cầu được thành công; yêu cầu còn lại nhận lỗi xung đột.
- 5a. Thiếu giá hoặc xe không hợp lệ: không tạo đơn, ghi lỗi phù hợp.
- 8a. Staff từ chối: bắt buộc lưu lý do, đơn chuyển trạng thái từ chối/hủy theo state machine đã chốt.

### Hậu điều kiện

- Đơn được lưu cùng người thuê, xe, khoảng thời gian và snapshot chi phí.
- Availability được tính từ trạng thái xe và các đơn chiếm lịch; không dựa vào trạng thái frontend.

## 3. UC-S01 — Staff xử lý đơn thuê

**Actor chính:** Staff  
**Tiền điều kiện:** Staff đăng nhập và có quyền vận hành; đơn tồn tại và đang ở trạng thái cho phép xử lý.

### Luồng chính

1. Staff mở danh sách đơn mới/cần xử lý.
2. Staff xem thời gian thuê, xe, User, điểm nhận và tổng tiền đã được backend tính.
3. Staff xác nhận đơn hoặc từ chối kèm lý do.
4. Đúng khoảng thuê, Staff chi nhánh nhận đối chiếu GPLX tương thích còn hạn, ghi nhận thời gian/tình trạng xe rồi bàn giao.
5. Backend chuyển đơn sang trạng thái đang thuê khi điều kiện được đáp ứng.
6. Staff chi nhánh trả ghi nhận thời gian/tình trạng xe, cập nhật vị trí thực tế; hiện chỉ trả tại chi nhánh đã đặt.
7. Staff hoàn tất đơn hoặc báo xe cần bảo trì/xử lý thêm.
8. User xem được trạng thái mới và đủ điều kiện đánh giá sau khi đơn hoàn tất.

### Luồng thay thế/lỗi

- Đơn đã bị hủy hoặc bị Staff khác xử lý: không cho cập nhật theo state cũ; tải lại trạng thái hiện hành.
- Xe có vấn đề khi bàn giao/nhận: Staff ghi chú và chuyển trạng thái theo quy trình xử lý sự cố; không tự đánh dấu hoàn tất sai thực tế.
- Staff không có quyền với thao tác: trả lỗi authorization.

## 4. UC-G04 — Nhận gợi ý xe

**Actor chính:** Guest hoặc User  
**Tiền điều kiện:** Có thể không cần đăng nhập nếu chính sách Guest được bật; input đạt giới hạn cho phép.

### Luồng chính

1. Người dùng nhập số người, ngân sách, thời gian thuê (nếu có), mục đích chuyến đi, loại xe, sở thích và yêu cầu tự nhiên.
2. Backend validate và chuẩn hóa tiêu chí.
3. Nếu có free text, Gemini có thể chuyển thành criteria JSON; backend validate lại kết quả.
4. Backend lấy xe từ catalog.
5. Backend loại xe bị ngừng khai thác, không đủ chỗ hoặc trùng lịch trong khoảng yêu cầu.
6. Backend chấm điểm từng xe còn lại và xếp thứ tự.
7. Gemini tạo lời giải thích cho danh sách xe và facts backend cung cấp.
8. Backend kiểm tra kết quả giải thích và trả xe, điểm, score breakdown, lý do.
9. Người dùng xem chi tiết xe; User có thể tiếp tục đặt xe.

### Luồng thay thế/lỗi

- Không còn xe phù hợp: trả danh sách rỗng và gợi ý nới tiêu chí; không bịa xe.
- Gemini lỗi/timeout: vẫn có thể trả xe đã xếp hạng cùng thông báo giải thích AI tạm thời không khả dụng.
- Gemini trả ID hoặc fact không thuộc input: loại bỏ phần không hợp lệ; không dùng làm dữ liệu hiển thị.
- Thiếu ngày thuê: kết quả không được khẳng định xe đang khả dụng; phải kiểm tra lại trước khi đặt.

## 5. UC-U06 — Tạo hành trình cá nhân hóa

**Actor chính:** User  
**Actor phối hợp:** Gemini API, Map API  
**Tiền điều kiện:** User đăng nhập để lưu hành trình; điểm đi và thời gian hợp lệ.

### Luồng chính

1. User nhập điểm xuất phát/đến, ngày đi/về, ngân sách, số người và sở thích.
2. Backend xác thực dữ liệu và giới hạn độ dài chuyến đi/số địa điểm.
3. Backend xác định tọa độ bằng dữ liệu có sẵn hoặc geocoding.
4. Backend truy vấn các địa điểm phù hợp từ catalog địa điểm.
5. Map API trả khoảng cách/thời gian giữa các điểm cần thiết.
6. Backend gửi constraint, candidate locations và route estimates đến Gemini.
7. Gemini trả kế hoạch theo ngày với thứ tự và khung giờ dự kiến.
8. Backend xác nhận các location ID thuộc candidates, ngày nằm trong chuyến đi và thời gian hợp lệ.
9. Backend lưu itinerary và các mục lịch trình.
10. React hiển thị kế hoạch theo ngày cùng thông tin tuyến ước tính.

### Luồng thay thế/lỗi

- Không tìm thấy candidate phù hợp: yêu cầu User đổi vùng/sở thích và thử lại; chưa có trình sắp xếp thủ công đầy đủ trong MVP.
- Map API lỗi hoặc thiếu tuyến kiểm chứng: dừng và cho thử lại, không lưu bản thiếu tuyến.
- AI lỗi/JSON không hợp lệ: không lưu, cho thử lại; chưa có trình chỉnh sửa thủ công đầy đủ trong MVP.
- Output dùng location ID ngoài danh sách: từ chối trước khi lưu.

## 6. UC-A01 — Quản lý tài khoản và nhân viên

**Actor chính:** Admin

1. Admin tìm kiếm tài khoản theo email, tên hoặc trạng thái.
2. Admin xem role và trạng thái hiện tại.
3. Admin tạo/cập nhật tài khoản Staff hoặc khóa/mở tài khoản theo quyền.
4. Backend xác thực thay đổi role và ngăn thao tác trái quyền.
5. Hệ thống lưu thay đổi; các thao tác quản trị quan trọng có thể được audit ở giai đoạn thiết kế chi tiết.

Admin không được xem mật khẩu dạng rõ. Hệ thống chỉ lưu hash mật khẩu.

## 7. Quyền truy cập khái quát

| Nghiệp vụ               |           Guest |                          User |                                   Staff |                          Admin |
| ----------------------- | --------------: | ----------------------------: | --------------------------------------: | -----------------------------: |
| Duyệt/tìm kiếm/xem xe   |              Có |                            Có |                                      Có |                             Có |
| Đặt xe                  |           Không |                            Có |                        Không thay khách | Không thay khách theo mặc định |
| Xem đơn                 |           Không |                  Đơn của mình |                  Đơn vận hành được phép |                        Toàn bộ |
| Hủy đơn                 |           Không | Đơn của mình, theo chính sách |                 Hỗ trợ/xử lý theo quyền |             Có quyền can thiệp |
| Xác nhận, giao/nhận xe  |           Không |                         Không |                     Đúng chi nhánh nghiệp vụ | Không mặc định kế thừa |
| Quản lý dữ liệu catalog |           Không |                         Không | Cập nhật tình trạng vận hành theo quyền |                             Có |
| Gửi đánh giá            |           Không |              Khi đủ điều kiện |                                   Không |                          Không |
| Kiểm duyệt đánh giá     |           Không |                         Không |                          Không mặc định |                             Có |
| Dùng AI                 | Preview nếu bật |                Có, có thể lưu |              Không phải nghiệp vụ chính |                Có thể kiểm tra |

## 8. Các quyết định cần mang sang giai đoạn sau

- Role tài khoản: `USER`, `STAFF`, `ADMIN`; Guest là actor chưa xác thực.
- Staff làm nghiệp vụ đơn thuê/giao nhận; Admin quản trị tài khoản và catalog.
- Backend là nguồn sự thật cho availability, giá và state transition.
- AI và map là tích hợp bên ngoài qua backend adapter.
- Tách chi nhánh giao nhận (`branch`) và điểm tham quan (`location`); baseline hiện hỗ trợ nhận/trả khác chi nhánh, Staff được phân công.
- Guest AI, mô hình/provider, Map provider, cọc, phụ phí, gia hạn/no-show vẫn còn mở; GPLX, block 24 giờ, hold 2 giờ và thời điểm phát hành đã chốt tại [sổ quyết định](../architecture/decisions.md).
- Backend tổ chức theo nghiệp vụ, không có module dữ liệu riêng `staff`/`admin`; các quyền và use case của hai actor vẫn được giữ. Xem [ranh giới module](../architecture/module-boundaries.md).

## 9. Sự cố và trách nhiệm

User/Staff/Admin theo quyền báo sự cố của chuyến đã giao xe; có thể báo sau khi hoàn tất nhưng thời điểm xảy ra phải có căn cứ liên hệ thời gian khách giữ xe. Staff thẩm định thiệt hại, căn cứ trách nhiệm, khoản bảo hiểm/bên khác chi trả và khoản đề nghị; Admin duyệt gửi yêu cầu; User được phản hồi. Hồ sơ có nhật ký riêng, không sửa đơn COMPLETED thành một trạng thái sự cố. Không tự kết luận lỗi hoặc khấu trừ cọc. Source còn thiếu kiểm tra biên thời điểm/quyền khóa xe và lịch sử căn cứ đầy đủ; xem L01/L02/L09 trong audit.
