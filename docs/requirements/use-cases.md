# Giai đoạn 1 — Actor và Use Case

> Cập nhật 29/09/2026: các use case là yêu cầu, không phải chứng nhận source hoàn tất. Quyết định đa chi nhánh/GPLX/sự cố/AI tại [sổ quyết định](../architecture/decisions.md), trạng thái thực tại [audit](../architecture/system-architecture.md). Gemini trong các luồng dưới là phương án ban đầu, provider/mô hình cuối chưa chốt.
>
> Cập nhật 05/10/2026: bộ UC tách và bổ sung từ 22 → 28 sau rà soát độ tường minh.
>
> Cập nhật 06/10/2026: chuẩn hóa tên UC theo quy tắc "một động từ — một đối tượng"; tách UC-A06 cũ thành UC-A06 (chi nhánh) và UC-A10 (tuyến xe); tổng 29 UC.

## 1. Danh sách Use Case

| ID     | Use case                        | Actor chính | Mức ưu tiên |
| ------ | ------------------------------- | ----------- | ----------- |
| UC-G01 | Tìm kiếm xe                     | Guest, User | MVP         |
| UC-G02 | Xem thông tin xe                | Guest, User | MVP         |
| UC-G03 | Đăng ký tài khoản               | Guest       | MVP         |
| UC-G04 | Gợi ý xe                        | Guest, User | MVP         |
| UC-U01 | Quản lý thông tin cá nhân       | User        | MVP         |
| UC-U02 | Kiểm tra xe khả dụng            | User        | MVP         |
| UC-U03 | Đặt xe                          | User        | MVP         |
| UC-U04 | Xem lịch sử thuê xe             | User        | MVP         |
| UC-U05 | Hủy đơn thuê                    | User        | MVP         |
| UC-U06 | Đánh giá xe                     | User        | MVP         |
| UC-U07 | Lập hành trình                  | User        | MVP         |
| UC-U08 | Khai báo GPLX                   | User        | MVP         |
| UC-U09 | Báo cáo sự cố                   | User        | MVP         |
| UC-S01 | Xử lý đơn thuê                  | Staff       | MVP         |
| UC-S02 | Bàn giao xe                     | Staff       | MVP         |
| UC-S03 | Tiếp nhận xe trả                | Staff       | MVP         |
| UC-S04 | Cập nhật tình trạng xe          | Staff       | MVP         |
| UC-S05 | Thẩm định sự cố                 | Staff       | MVP         |
| UC-S06 | Xác minh GPLX                   | Staff       | MVP         |
| UC-A01 | Quản lý tài khoản               | Admin       | MVP         |
| UC-A02 | Quản lý xe                      | Admin       | MVP         |
| UC-A03 | Quản lý địa điểm                | Admin       | MVP         |
| UC-A04 | Kiểm duyệt đánh giá             | Admin       | MVP         |
| UC-A05 | Xem báo cáo vận hành            | Admin       | Nên có      |
| UC-A06 | Quản lý chi nhánh               | Admin       | MVP         |
| UC-A07 | Phân công nhân viên             | Admin       | MVP         |
| UC-A08 | Quản lý danh mục xe             | Admin       | MVP         |
| UC-A09 | Duyệt bồi thường                | Admin       | MVP         |
| UC-A10 | Quản lý tuyến xe                | Admin       | MVP         |

## 2. UC-U02 / UC-U03 — Kiểm tra xe khả dụng và Đặt xe

> Tách từ UC-U02 cũ (05/10/2026). UC-U02 là bước xem báo giá; UC-U03 là bước xác nhận đặt xe.

**Actor chính:** User
**Actor phối hợp:** Staff
**Tiền điều kiện:** User đăng nhập; xe đang được khai thác; khoảng thuê hợp lệ.

### Luồng chính — UC-U02 (Kiểm tra xe khả dụng)

1. User chọn xe, thời gian và chi nhánh nhận/trả trong tuyến được phép.
2. Backend validate ngày giờ, trạng thái xe và chuỗi chi nhánh.
3. Backend tính số ngày (đơn mới lấy chênh lệch ngày nhận/trả tại Việt Nam; đơn cũ giữ block 24 giờ), phí tuyến và tổng tiền dự kiến.
4. Hệ thống trả báo giá và thông tin khả dụng cho User xem xét.
5. User có thể thay đổi điều kiện và xem báo giá lại nhiều lần.

### Luồng chính — UC-U03 (Đặt xe)

1. User xác nhận báo giá và gửi yêu cầu đặt xe.
2. Backend khóa xe, kiểm tra lại lịch chiếm và snapshot giá tại thời điểm tạo.
3. Backend tạo đơn PENDING và lưu snapshot chi phí.
4. Hệ thống trả mã đơn và tổng kết cho User.
5. Staff xem đơn trong hàng đợi, xác nhận hoặc từ chối kèm lý do.
6. Hệ thống thông báo trạng thái để User tra cứu.

### Luồng thay thế/lỗi

- Thời gian nhận không trước thời gian trả: từ chối với lỗi validation.
- Xe đã được đặt trùng lịch: không tạo đơn; yêu cầu chọn xe hoặc thời gian khác.
- Có yêu cầu đồng thời đặt cùng xe: chỉ một yêu cầu thành công; yêu cầu còn lại nhận lỗi xung đột.
- Thiếu giá hoặc xe không hợp lệ: không tạo đơn, ghi lỗi phù hợp.
- Staff từ chối: bắt buộc lưu lý do, đơn chuyển trạng thái từ chối/hủy theo state machine đã chốt.

### Hậu điều kiện

- Đơn được lưu cùng người thuê, xe, khoảng thời gian và snapshot chi phí.
- Availability được tính từ trạng thái xe và các đơn chiếm lịch; không dựa vào trạng thái frontend.

## 3. UC-S01 — Xử lý đơn thuê

**Actor chính:** Staff
**Tiền điều kiện:** Staff đăng nhập và có quyền vận hành; đơn tồn tại và đang ở trạng thái cho phép xử lý.

### Luồng chính

1. Staff mở danh sách đơn mới/cần xử lý.
2. Staff xem thời gian thuê, xe, khách, điểm nhận và tổng tiền đã được backend tính.
3. Staff xác nhận đơn hoặc từ chối kèm lý do.
4. Đúng khoảng thuê, Staff chi nhánh nhận thực hiện UC-S06 xác minh GPLX, ghi nhận thời gian/tình trạng xe rồi bàn giao.
5. Backend chuyển đơn sang trạng thái đang thuê khi điều kiện được đáp ứng.
6. Staff chi nhánh trả ghi nhận thời gian/tình trạng xe, cập nhật vị trí thực tế; hiện chỉ trả tại chi nhánh đã đặt.
7. Staff hoàn tất đơn hoặc báo xe cần bảo trì/xử lý thêm.
8. Khách xem được trạng thái mới và đủ điều kiện đánh giá sau khi đơn hoàn tất.

### Luồng thay thế/lỗi

- Đơn đã bị hủy hoặc bị Staff khác xử lý: không cho cập nhật theo state cũ; tải lại trạng thái hiện hành.
- Xe có vấn đề khi bàn giao/nhận: Staff ghi chú và chuyển trạng thái theo quy trình xử lý sự cố; không tự đánh dấu hoàn tất sai thực tế.
- Staff không có quyền với thao tác: trả lỗi authorization.

## 4. UC-S06 — Xác minh GPLX

> UC bổ sung 05/10/2026. Tách từ bước 4 của UC-S01/UC-S02 vì đây là luồng nghiệp vụ độc lập có thể thất bại riêng.

**Actor chính:** Staff
**Tiền điều kiện:** Đơn đã được xác nhận (CONFIRMED); khách đến nhận xe; Staff thuộc chi nhánh nhận.

### Luồng chính

1. Staff mở thông tin GPLX mà khách đã khai báo trong hệ thống.
2. Hệ thống hiển thị kết quả kiểm tra tự động: hạng tương thích, còn hiệu lực đến hết thuê, hộp số/hạn chế.
3. Staff đối chiếu GPLX vật lý với thông tin trên hệ thống.
4. Staff xác nhận GPLX hợp lệ → tiến hành bàn giao xe (UC-S02).

### Luồng thay thế/lỗi

- GPLX hết hạn hoặc sai hạng: Staff từ chối bàn giao; ghi nhận lý do; đơn không chuyển sang IN_PROGRESS.
- Khách chưa khai báo GPLX: hệ thống cảnh báo; Staff không được bỏ qua bước xác minh.

## 5. UC-G04 — Gợi ý xe

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

## 6. UC-U07 — Lập hành trình

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
10. Frontend hiển thị kế hoạch theo ngày cùng thông tin tuyến ước tính.

### Luồng thay thế/lỗi

- Không tìm thấy candidate phù hợp: yêu cầu User đổi vùng/sở thích và thử lại; chưa có trình sắp xếp thủ công đầy đủ trong MVP.
- Map API lỗi hoặc thiếu tuyến kiểm chứng: dừng và cho thử lại, không lưu bản thiếu tuyến.
- AI lỗi/JSON không hợp lệ: không lưu, cho thử lại; chưa có trình chỉnh sửa thủ công đầy đủ trong MVP.
- Output dùng location ID ngoài danh sách: từ chối trước khi lưu.

## 7. UC-A01 — Quản lý tài khoản

**Actor chính:** Admin

1. Admin tìm kiếm tài khoản theo email, tên hoặc trạng thái.
2. Admin xem role và trạng thái hiện tại.
3. Admin tạo/cập nhật tài khoản nhân viên hoặc khóa/mở tài khoản theo quyền.
4. Backend xác thực thay đổi role và ngăn thao tác trái quyền.
5. Hệ thống lưu thay đổi; các thao tác quản trị quan trọng có thể được audit ở giai đoạn thiết kế chi tiết.

Admin không được xem mật khẩu dạng rõ. Hệ thống chỉ lưu hash mật khẩu.

## 8. UC-A07 — Phân công nhân viên

> UC bổ sung 05/10/2026. Tách từ UC-A01 cũ vì đây là thao tác vận hành định kỳ, độc lập với quản lý tài khoản.

**Actor chính:** Admin
**Tiền điều kiện:** Tài khoản nhân viên đã tồn tại; chi nhánh đã được thiết lập.

### Luồng chính

1. Admin chọn nhân viên và xem danh sách chi nhánh đang được phân công.
2. Admin thêm phân công chi nhánh cho nhân viên. Thu hồi phân công là đề xuất cần đối chiếu quyết định và hợp đồng API trước triển khai.
3. Backend kiểm tra nhân viên tồn tại, chi nhánh hợp lệ và không vi phạm ràng buộc nghiệp vụ.
4. Hệ thống lưu phân công; backend kiểm tra quyền vận hành theo phân công hiện hành.

### Lưu ý nghiệp vụ

- Một nhân viên có thể được phân công vào nhiều chi nhánh.
- Chính sách thu hồi phân công và xử lý đơn đang dở chưa được tự chốt trong lượt chuẩn hóa này.
- Admin không kế thừa quyền vận hành giao/nhận xe tại chi nhánh.

## 9. UC-A06 / UC-A10 — Quản lý chi nhánh và Quản lý tuyến xe

> UC-A06 và UC-A10 tách từ UC-A06 cũ (06/10/2026) vì chi nhánh và tuyến xe là hai đối tượng nghiệp vụ khác nhau.

### UC-A06 — Quản lý chi nhánh

**Đối tượng:** Địa điểm vật lý nơi khách nhận và trả xe.

**Admin quản lý:**
- Thêm/sửa/đóng chi nhánh (tên, địa chỉ, trạng thái; giờ hoạt động là đề xuất chưa thuộc baseline đã duyệt).
- Xem danh sách nhân viên thuộc chi nhánh.

### UC-A10 — Quản lý tuyến xe

**Đối tượng:** Cặp chi nhánh nhận–trả được phép và phí phụ thu một chiều.

**Admin quản lý:**
- Mở/đóng tuyến giữa hai chi nhánh.
- Đặt phí tuyến một chiều (ví dụ: HCM → Đà Nẵng: 500.000đ).
- Phí tuyến là dữ liệu cấu hình, phải công khai và được snapshot vào đơn thuê.

**Phân biệt:**

| | Quản lý chi nhánh | Quản lý tuyến xe |
|---|---|---|
| Đối tượng | Văn phòng/địa điểm | Cặp (nhận → trả) + phí |
| Khi nào dùng | Mở/đóng văn phòng | Cho phép nhận-trả khác nơi |
| Ảnh hưởng | Nhân viên, vị trí xe | Giá thuê, tùy chọn đặt xe |

## 10. Quyền truy cập khái quát

| Nghiệp vụ               |           Guest |                          User |                                   Staff |                          Admin |
| ----------------------- | --------------: | ----------------------------: | --------------------------------------: | -----------------------------: |
| Tìm kiếm/xem xe         |              Có |                            Có |                                      Có |                             Có |
| Đặt xe                  |           Không |                            Có |                        Không thay khách | Không thay khách theo mặc định |
| Xem đơn                 |           Không |                  Đơn của mình |                  Đơn vận hành được phép |                        Toàn bộ |
| Hủy đơn                 |           Không | Đơn của mình, theo chính sách |                 Hỗ trợ/xử lý theo quyền |             Có quyền can thiệp |
| Xác nhận, giao/nhận xe  |           Không |                         Không |                   Đúng chi nhánh nghiệp vụ | Không mặc định kế thừa |
| Quản lý dữ liệu catalog |           Không |                         Không | Cập nhật tình trạng vận hành theo quyền |                             Có |
| Đánh giá xe             |           Không |              Khi đủ điều kiện |                                   Không |                          Không |
| Kiểm duyệt đánh giá     |           Không |                         Không |                          Không mặc định |                             Có |
| Dùng AI                 | Preview nếu bật |                Có, có thể lưu |              Không phải nghiệp vụ chính |                Có thể kiểm tra |

## 11. Các quyết định cần mang sang giai đoạn sau

- Role tài khoản: `USER`, `STAFF`, `ADMIN`; Guest là actor chưa xác thực.
- Nhân viên làm nghiệp vụ đơn thuê/giao nhận; Admin quản trị tài khoản và catalog.
- Backend là nguồn sự thật cho availability, giá và state transition.
- AI và map là tích hợp bên ngoài qua backend adapter.
- Tách chi nhánh giao nhận (`branch`) và điểm tham quan (`location`); baseline hiện hỗ trợ nhận/trả khác chi nhánh, nhân viên được phân công.
- Guest AI, mô hình/provider, Map provider, cọc, phụ phí, gia hạn/no-show vẫn còn mở; GPLX, tính thuê theo ngày cho đơn mới/giữ chính sách cũ, hold tối đa 2 giờ và thời điểm phát hành đã chốt tại [sổ quyết định](../architecture/decisions.md).
- Backend tổ chức theo nghiệp vụ, không có module dữ liệu riêng `staff`/`admin`; các quyền và use case của hai actor vẫn được giữ. Xem [ranh giới module](../architecture/module-boundaries.md).

## 12. Sự cố và trách nhiệm

Người dùng/Nhân viên/Admin theo quyền báo sự cố của chuyến đã giao xe; có thể báo sau khi hoàn tất nhưng thời điểm xảy ra phải có căn cứ liên hệ thời gian khách giữ xe. Nhân viên thẩm định thiệt hại, căn cứ trách nhiệm, khoản bảo hiểm/bên khác chi trả và khoản đề nghị; Admin duyệt gửi yêu cầu; khách được phản hồi. Hồ sơ có nhật ký riêng, không sửa đơn COMPLETED thành một trạng thái sự cố. Không tự kết luận lỗi hoặc khấu trừ cọc. Ghi chú thiếu L01/L02/L09 là audit lịch sử; đối chiếu các nghiệm thu sau trong system-architecture.md trước kết luận còn lỗi. Kết quả scoped không chứng minh toàn bộ chức năng.


## 13. Quy ước chuẩn hóa và đặc tả User bổ sung — 06/10/2026

Có 29 UC nghiệp vụ (Admin 10, Staff 6, Guest 4, User 9), cộng Đăng nhập dùng chung không gán thêm mã nghiệp vụ. Quy tắc tên ngắn là quy ước của dự án, không phải yêu cầu bắt buộc của UML. Đăng nhập tạo phiên; phiên hợp lệ là tiền điều kiện của UC cần xác thực, không có nghĩa mỗi thao tác đều thực hiện lại đăng nhập. User sử dụng chung G01/G02. G04 Guest chỉ hoạt động khi chính sách được duyệt, không coi preview là quyền mặc định.

Tên rút gọn không bỏ nghiệp vụ đã có: U04 vẫn có chi tiết đơn, hợp đồng và hóa đơn; U09 vẫn có theo dõi sự cố và phản hồi yêu cầu bồi thường. Không đổi role, API, module hoặc schema chỉ vì đổi tên UC.

| UC | Luồng chính và hậu điều kiện | Ca từ chối cần kiểm chứng |
|---|---|---|
| U01 | User xem/cập nhật hồ sơ của mình; đổi mật khẩu theo hợp đồng auth; dữ liệu được lưu và đọc lại đúng | Input sai, mật khẩu hiện tại sai, phiên hết hạn, tác động tài khoản khác |
| U02 | Chọn xe, thời gian, tuyến; backend trả giá và khả dụng; quote là thông tin để đặt, chưa tạo đơn | Thời gian/tuyến sai, xe không khả dụng, response cũ không ghi đè lựa chọn mới |
| U03 | Xác nhận thông tin và quote mới nhất; backend kiểm tra lại, tạo đơn hợp lệ; mở chi tiết đơn | GPLX thiếu/không phù hợp, quote hết hiệu lực hoặc xung đột, gửi lặp; không tạo đơn sai |
| U04 | Xem danh sách và chi tiết đơn của mình; đọc hợp đồng khi xác nhận, hóa đơn khi hoàn tất | Đơn/tài liệu của User khác; tài liệu chưa phát hành; lỗi API không đổi sang demo |
| U05 | Hủy đơn của mình trong trạng thái và thời hạn chính sách đã duyệt; đọc lại trạng thái | Đơn người khác, trạng thái/thời hạn không cho phép; backend quyết định |
| U06 | Đánh giá chuyến đủ điều kiện; đọc lại kết quả theo chính sách kiểm duyệt | Chưa COMPLETED, không sở hữu, đánh giá trùng hoặc input sai |
| U07 | Lập và lưu hành trình gắn chuyến hợp lệ, tuyến/thời gian được kiểm chứng; đọc lại hành trình | Không sở hữu, dữ liệu sai, provider lỗi hoặc tuyến không kiểm chứng; AI/Map còn cần quyết định |
| U08 | Khai báo GPLX theo scheme đã duyệt; đọc lại dữ liệu; kiểm tra phù hợp xe và hiệu lực đến hết thuê | Sai scheme/hạng/dữ liệu/hạn; khai báo không thay xác minh trực tiếp của Staff |
| U09 | Báo sự cố thuộc thời gian giữ xe thực tế; xem tiến trình, phản hồi yêu cầu bồi thường theo vòng đời đã duyệt | Sai chủ sở hữu/thời điểm/trạng thái; không tự kết luận trách nhiệm hoặc trừ cọc |

Các UC cần User có phiên hợp lệ; backend kiểm tra quyền và sở hữu ở mọi thao tác. Hết phiên/đăng xuất phải chặn response cũ tái lập phiên. Đặc tả này không duyệt thêm cọc, phụ phí, no-show, retention hoặc provider. Quy tắc giao diện hiện hành xem [giao diện khách hàng](../ui/customer-experience.md). Kế hoạch và bằng chứng nghiệm thu được giữ riêng trong tài liệu nội bộ.
