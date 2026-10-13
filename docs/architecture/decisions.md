# Quyết định kiến trúc và vấn đề còn mở

Cập nhật audit: 29/09/2026. Đây là nguồn quyết định chung, đã hợp nhất note baseline 28/09. Quyết định được duyệt không đồng nghĩa chức năng đã nghiệm thu. Backend và frontend API đang thực hiện; kết quả kiểm tra và sai lệch tại [kiến trúc hệ thống](system-architecture.md).

## Đã chốt

| ID | Quyết định | Lý do và tác động |
|---|---|---|
| AD-01 | React/Vite, Spring Boot, MySQL, JPA/Hibernate, Security/JWT; tích hợp AI/Map qua backend | Giữ stack cốt lõi; Gemini là phương án ban đầu, chưa chốt nhà cung cấp/mô hình AI cuối cùng |
| AD-02 | Modular monolith, một backend/một database | Vừa sức ba tháng, transaction đơn giản; giữ ranh giới module rõ ràng |
| AD-03 | Đúng bốn actor; Guest không là role tài khoản | Role USER/STAFF/ADMIN; Gemini/Map là hệ thống ngoài |
| AD-04 | Backend kiểm soát giá, availability, ID, score và trạng thái | AI giải thích/lập phương án trên dữ liệu cấp sẵn; cần validate output |
| AD-05 | Backend chia theo nghiệp vụ, bỏ module giữ chỗ staff/admin | Tránh trùng logic theo role; giữ đầy đủ chức năng và pages frontend |
| AD-06 | Hỗ trợ đa chi nhánh nhận/trả và tuyến xe | Cho phép nhận/trả khác chi nhánh (qua `branch_routes`), theo dõi `current_branch_id` của xe; Staff phân quyền theo chi nhánh trực thuộc |
| AD-07 | Flyway chỉ ở backend/src/main/resources/db/migration | Schema có một lịch sử duy nhất (`V1__rental_schema.sql`); test chạy tự động qua Flyway |
| AD-08 | VS Code viết/chạy/debug cả backend và frontend | Giảm số công cụ phải học; build Java qua Maven chuẩn |
| AD-09 | Database tối đa 30 bảng; V1 có 25 bảng nghiệp vụ | Cộng lịch sử Flyway là 26; có schema chi nhánh/GPLX/sự cố, chưa đồng nghĩa đủ toàn bộ nghiệp vụ |
| AD-10 | MVP không thanh toán online, không microservices | Tập trung luồng thuê xe, quản lý vận hành và hai chức năng AI |
| AD-11 | Xác minh GPLX theo tương thích xe | Xét hệ bằng cũ (VN_PRE_2025) và mới (VN_2025), số chỗ, hộp số; Staff kiểm tra đối chiếu khi bàn giao |
| AD-12 | Quy trình xử lý sự cố & bồi thường có căn cứ | `IncidentCase` độc lập vòng đời đơn; phân biệt rõ thiệt hại xe, bảo hiểm chi trả, yêu cầu bồi thường; có nhật ký sự kiện `incident_events` |
| AD-13 | Triển khai AI sau backend | Hoàn thành và kiểm thử toàn bộ backend nghiệp vụ cốt lõi trước khi tích hợp module AI |

## Còn mở — phải chốt trước bước phụ thuộc

| ID | Nội dung | Phương án đang xem xét, chưa áp dụng | Chốt trước |
|---|---|---|---|
| OP-01 | Guest dùng AI | Giai đoạn 1 đề xuất preview; Giai đoạn 2 đề xuất chỉ User để giảm quota. Chưa chọn giữa hai phương án | API/UX AI |
| OP-02 | Giấy phép lái xe — chốt một phần | Tương thích xe, hệ cũ/mới, còn hiệu lực đến hết thuê, Staff đối chiếu trước giao, không ảnh. Source đã lưu số/hạng/hạn, người/thời điểm kiểm tra và snapshot giao xe; chưa có lịch sử xác minh riêng hoặc tra cứu cơ sở dữ liệu quốc gia | Hoàn thiện GPLX/giao nhận |
| OP-03 | Ngày thuê/giá/cọc — chốt một phần | Đã duyệt block 24 giờ làm tròn lên, VND nguyên đồng, UTC lưu và Asia/Ho_Chi_Minh hiển thị; mức/ý nghĩa cọc và làm tròn khoản tính theo tỷ lệ còn mở | Schema snapshot và booking |
| OP-04 | PENDING/state machine — chốt một phần | Đã duyệt giữ lịch 2 giờ không vượt giờ nhận và luồng PENDING → CONFIRMED → IN_PROGRESS → RETURNED → COMPLETED; còn quy tắc đệm, no-show, gia hạn, trả muộn/đơn kế tiếp | ERD và transaction booking |
| OP-05 | Hợp đồng/hóa đơn — chốt một phần | Đã duyệt hợp đồng khi xác nhận, hóa đơn khi hoàn tất, lưu snapshot; chính sách sửa/phát hành lại và danh mục phụ phí còn mở | Schema và luồng phát hành |
| OP-06 | Hủy và Admin can thiệp — chốt một phần | Đã duyệt User tự hủy trước giờ nhận ít nhất 24 giờ, sát giờ Staff xử lý và ghi lý do; Admin can thiệp hủy, không mặc định giao/nhận; điều kiện ngoại lệ chi tiết còn mở | Ma trận quyền chi tiết/state machine |
| OP-07 | Map provider | Chọn theo tài khoản, coverage, quota và điều kiện sử dụng; không mặc định OpenStreetMap là một dịch vụ API đầy đủ | Adapter Map |
| OP-08 | JWT/khóa tài khoản — chốt một phần | Đã duyệt access token ngắn hạn, không refresh, kiểm tra trạng thái và token_version, đăng xuất mọi phiên. Source dùng TTL mặc định 30 phút (cấu hình 1–120), localStorage; đây là cấu hình hiện tại, cần đánh giá bảo mật client trước phát hành | Nghiệm thu auth |
| OP-09 | Fallback itinerary — đã chốt MVP | Không đủ dữ liệu kiểm chứng thì dừng/thử lại; không lưu bản thiếu tuyến, chưa triển khai trình chỉnh sửa thủ công đầy đủ | UI/API itinerary |
| OP-10 | Môi trường/phiên bản — đã chốt/kiểm chứng | Đã có Maven Wrapper (`mvnw`, `mvnw.cmd`). Đã kiểm chứng độc lập trên Java 21, Spring Boot 3.5.16, MySQL 8.4.11 thật (port 33385/33393/33394/33396/33397) và H2; seed opt-in an toàn. Còn mở: kế hoạch kiểm kê DB môi trường dùng chung khác trước nâng cấp | Nghiệm thu runtime (Đã đạt local) |

## Baseline nghiệp vụ đã duyệt ngày 28/09/2026

- Cho phép nhận/trả tại các chi nhánh doanh nghiệp được mở tuyến, không nhận địa chỉ tùy ý. `branches` là điểm giao nhận; `locations` là điểm tham quan.
- Tách nơi quản lý xe, vị trí xe hiện tại, điểm nhận/trả dự kiến và thực tế. Không coi xe đã về vì qua giờ trả. Source hiện ghi `actual_return_branch_id`, biên bản có chi nhánh và thời điểm; điểm trả thực tế bị giới hạn bằng điểm trả đã đặt, chưa hỗ trợ đổi điểm giữa chuyến.
- Lịch xe kiểm tra thời gian và chuỗi chi nhánh: chuyến sau phải nhận nơi chuyến trước trả; chuyến chèn không được phá vị trí nhận của chuyến kế. Không giả định có điều chuyển ngoài hệ thống. Đơn đang thuê quá hạn tiếp tục chặn xe; xe bảo trì/ngừng khai thác không nhận đơn mới.
- Staff được gán chi nhánh; xác nhận/giao tại chi nhánh nhận, nhận trả/hoàn tất tại chi nhánh trả. Admin không kế thừa giao nhận. Source có gán thêm chi nhánh, chưa có thu hồi phân công.
- Phí tuyến phải cấu hình, công khai và snapshot. Mức phí trong seed chỉ là dữ liệu thử, không phải chính sách kinh doanh được duyệt.
- GPLX xét tương thích, không so thứ bậc tên bằng. Phạm vi code hiện là ô tô con 2–9 chỗ kể cả người lái, hệ VN_PRE_2025/VN_2025, hộp số/hạn chế và hạn dùng; Staff xác minh lại trước giao. Không tuyên bố đã kiểm tra cơ sở dữ liệu GPLX quốc gia.
- Người dùng đã chọn: “Người thuê chịu trách nhiệm đối với vi phạm/thiệt hại thuộc trách nhiệm của mình, theo chứng cứ và căn cứ xử lý”. Không quy mọi lỗi cho khách, không tự trừ cọc. Điều khoản phục vụ đồ án chưa phải mẫu hợp đồng được thẩm định pháp lý.
- Hồ sơ sự cố/vi phạm độc lập vòng đời đơn, có thể báo sau khi trả. Phân biệt thiệt hại, căn cứ trách nhiệm, bảo hiểm/bên khác chi trả và yêu cầu bồi thường. Việc báo muộn không có nghĩa được gán sự việc ngoài thời gian khách giữ xe cho khách.
- Chưa tự tính cọc, phụ phí trễ hạn, lãi/phạt hoặc thu tiền. Hóa đơn không chứng minh đã thanh toán. Tiền VND nguyên đồng; thời điểm UTC, hiển thị Asia/Ho_Chi_Minh.
- Gia hạn, no-show, tự điều chuyển chưa triển khai; không chuyển trạng thái tùy tiện để giả lập các luồng này.
- AI bắt đầu sau backend cốt lõi. Chưa chốt Gemini hay mô hình tự train; phải đánh giá dữ liệu/chi phí/schema khi chọn, không tạo bảng huấn luyện dự phòng. Các mô tả Gemini trong kiến trúc/use case là phương án tích hợp ban đầu.
- Chọn lọc UI từ `KLTN-Design/release-stable-win/data/projects/be266e30-839c-4726-977e-cfdb48c99209/KLTN-UI-Redesign/src/pages`, thích nghi với routing/auth/API KLTN; không nhập cả folder/project hoặc mock store. Có màn hình API không chứng minh đã kiểm thử E2E.

Thông tin phạm vi đã được gửi các chat Giai đoạn 2, 3 và 4; không yêu cầu sửa file song song. Workspace KLTN hiện tại là nguồn chung; worktree cũ không trở thành baseline mới. Các kết quả QA ngày 27/09 chỉ áp dụng UI demo ở lần bàn giao đó.

## Trade-off và rủi ro

| Rủi ro | Hướng xử lý | Giá phải trả/kiểm chứng |
|---|---|---|
| Đặt trùng khi đồng thời | Transaction và khóa xe, truy vấn overlap hiện hành | Tăng thời gian chờ cùng xe; kiểm thử đồng thời trên MySQL |
| Phụ thuộc vòng giữa module | Service điều phối, DTO, không truy cập chéo repository | Phải rà dependency khi bổ sung luồng phát hành hồ sơ |
| AI bịa facts/lịch không khả thi | Schema + validation nghiệp vụ, output chỉ tham chiếu dữ liệu được cấp | Không bảo đảm mọi lịch hấp dẫn; cần bộ tình huống đánh giá |
| Gemini/Map chậm hoặc hết quota | Timeout, giới hạn input/calls, fallback minh bạch | Trải nghiệm giảm khi dịch vụ ngoài lỗi |
| Lệch schema | Một nguồn Flyway, Hibernate validate | Không sửa migration đã chạy; thay đổi cần migration mới |
| Quá nhiều công cụ | VS Code là trung tâm; browser, Git, MySQL phục vụ vai trò rõ | Không tận dụng mọi tính năng của IDE khác, đổi lại dễ học và demo |
| Vượt thời gian/số bảng | Hoàn thành MVP trước, ERD có ngân sách bảng | Dashboard, thông báo, audit nâng cao để sau |

## Cách giải thích với hội đồng

- Role trả lời “ai được làm”; module trả lời “nghiệp vụ nào chịu trách nhiệm”. Vì vậy không cần module dữ liệu Admin riêng.
- Catalog xe và đơn thuê là dữ liệu chuẩn; AI chỉ hỗ trợ lựa chọn và lập lịch nên lỗi AI không làm sai giao dịch.
- Một backend giúp triển khai và kiểm thử phù hợp nguồn lực cá nhân, vẫn có phân tách trách nhiệm để bảo trì.
- VS Code là nơi phát triển; React và Spring Boot giao tiếp qua REST, không có cơ chế liên kết hai IDE.
- Kiến trúc được duyệt là cơ sở cho ERD/state machine/API ở giai đoạn kế tiếp, không thay thế các thiết kế chi tiết đó.


## Bổ sung quyết định kiến trúc Giai đoạn 5 (04/10/2026)

| ID | Quyết định | Lý do và tác động |
|---|---|---|
| AD-14 | Ràng buộc biên thời gian sự cố (L01) | occurred_at phải nằm trong khung thời gian giữ xe thực tế giữa biên bản HANDOVER và RETURN (hoặc thời điểm hiện tại nếu xe đang thuê IN_PROGRESS). Cho phép báo muộn sau khi đã trả xe nhưng không gán sự việc ngoài khoảng giữ xe cho đơn thuê. |
| AD-15 | Phân quyền khóa xe sự cố theo chi nhánh hiện tại (L02) | Staff chỉ được kích hoạt lockVehicle=true (chuyển xe sang MAINTENANCE) nếu Staff được phân công tại chi nhánh hiện tại của xe (ehicle.currentBranchId). Admin có toàn quyền can thiệp. |
| AD-16 | Giao thức lock và snapshot lịch xe (L03) | Tuân thủ thứ tự khóa tài nguyên: Khóa Vehicle trước, sau đó khóa Booking. Schedule query đảm bảo trạng thái hiện hành, chống race condition khi đặt trùng lịch. |
| AD-17 | ExpectedVersion cho tuyến xe (L06) | Thao tác cập nhật ranch_routes nhận expectedVersion để bảo vệ chống lost update từ form cũ gửi chậm. |
| AD-18 | Đồng bộ Clock nghiệp vụ toàn hệ thống (L10) | Mọi service (RentalWorkflow, IncidentService, ContractService, InvoiceService, ReviewService, LicenseService, BookingService) nhận Clock từ Spring container để đảm bảo tính nhất quán thời gian và kiểm thử dịch chuyển thời gian. |
| AD-19 | Locking Read bảo đảm Current-read dưới MySQL REPEATABLE READ (L03 / F02) | Sử dụng truy vấn khóa PESSIMISTIC_WRITE (lockScheduleByVehicleId) khi kiểm tra lịch và tình trạng xe, buộc InnoDB đọc dữ liệu mới nhất đã commit thay vì đọc snapshot cũ. Khóa tài nguyên xe trước qua scalar ID (findVehicleIdById), tránh nạp entity cũ vào persistence context trước khi có lock. |
| AD-20 | Chuẩn hóa ranh giới module và Entry Point Workflow (F03) | Đặt controller xử lý vòng đời đơn và chứng từ (RentalWorkflowController) tại module operation, giữ nguyên URL REST và quyền; giao tiếp giữa review sang booking và branch sang user hoàn toàn qua typed API/service thay vì raw SQL cross-module. |



## Giới hạn nghiệm thu và Chuẩn bị Đóng Giai đoạn 5 — 06/10/2026

- **Trạng thái Kỹ thuật Lõi:** Các kiểm chứng kỹ thuật R1 (Modular Monolith, Concurrency, Rollback), R2/R2B (Browser Incident History, Re-assessment Immutability, Out-of-Order Race), và R3 (Git Bash scripts, fresh dependency, API proxy auth trên MySQL cô lập) đã đạt PASS trong các đợt kiểm thử scoped độc lập (xem Mục 14–18, 20 tại `system-architecture.md`).
- **Phân định Yêu cầu / Đề xuất / Quyết định:**
  - Bảng đề xuất (`user-decisions-table.md`) và ma trận ánh xạ Use Case (`uc-mapping-analysis.md`) tại `.runtime/r4-closure-ag-20261006/` là tài liệu chuẩn bị đóng Giai đoạn 5, **không tự động trở thành quyết định phê duyệt**.
  - **Phụ phí (Surcharges):** Phụ phí phát sinh thông thường (nhiên liệu, vệ sinh, trễ hạn) không được tự tiện đồng nhất hoặc ép vào hồ sơ sự cố (`incident_cases`).
  - **Snapshot:** Snapshot JSON hợp đồng và hóa đơn là bản ghi toàn vẹn dữ liệu nội bộ tại thời điểm phát hành, **không tự khẳng định có giá trị pháp lý** thay thế văn bản điện tử có thẩm định/chứng thực ngoài hệ thống.
  - **Tài khoản:** Trạng thái tài khoản trong source hiện tại chỉ gồm `ACTIVE` và `LOCKED`, không có `INACTIVE`. Không tự mở rộng thu thập CCCD/PII.
  - **AI & Bản đồ:** Mock data hoặc rule engine nội bộ **không chứng minh module AI đã hoàn tất**. Nhà cung cấp AI (Gemini Flash/OpenAI...) và Bản đồ (Leaflet/OSM/Google Maps) hiện chỉ là các phương án đề xuất chưa được phê duyệt chính thức; không gọi API ngoài hoặc tích hợp secret key khi chưa chốt quota, tài khoản và chi phí.
  - **Cơ sở dữ liệu môi trường dùng chung:** Sao lưu dữ liệu (Backup) không tự cấp quyền chạy Flyway `repair` hay `clean`. Mọi thao tác nâng cấp DB khác phải tuân thủ quy trình kiểm kê 5 bước độc lập sau khi xác định được target DB cụ thể.
- **Điều kiện Đóng Giai đoạn 5:** Người dùng xem xét và phê duyệt (hoặc phê duyệt hoãn) 8 quyết định nghiệp vụ còn mở (QD-01 $\rightarrow$ QD-08). Sau khi có phê duyệt của Người dùng, Giai đoạn 5 chính thức hoàn tất.


## Chỉ đạo ưu tiên trải nghiệm Guest/User — 06/10/2026

Người dùng yêu cầu lập kế hoạch/hoàn thiện tài liệu và giao Guest/User trước. Mục tiêu UX: home cóxeAPI thật; đăng ký USER thànhcông về /; login USER mặc định về /, giữ đích /user hợp lệ; Staff/Admin giữ home theo role. Triển khai/QA chưa thực hiện trong lượt lập kế hoạch. Xem kế hoạch GU trong docs/ui/phase-4-handoff.md. Không phê duyệt toàn bộ28UC, cọc/phụphí/no-show/snapshot/retention, AI/Map hoặc provider. Điều kiện đóng5 là phạmvi/phêduyệt và bằngchứng của phần triểnkhai tươngứng; không mặc định chỉ duyệt bảng đềxuất là chức năng hoàn tất.

### Đồng bộ Use Case — 06/10/2026
29 UC nghiệp vụ + Đăng nhập dùng chung; User dùng chung tìm/xem xe. Tách tên A10 và rút gọn tên không đổi API/schema/quyền. U04 giữ tài liệu thuê; U09 giữ phản hồi bồi thường. Thu hồi phân công, giờ hoạt động chi nhánh và Guest AI không được tự coi là quyết định đã duyệt. Kế hoạch User tại docs/ui/phase-4-handoff.md; U07 cần giải quyết quyết định AI/Map phụ thuộc trước triển khai. Các quyết định và audit lịch sử giữ nguyên.

## Chỉ đạo core trước AI — 07/10/2026
Người dùng yêu cầu audit toànproject và hoàn thiện nghiệp vụ cácactor trước mọiAI. G04/U07 hoãn sangphaseAI,khôngbịxóa/nóikhôngcầnvĩnhviễn. Onlinepaymentvẫnngoàiscope; policycònmởkhôngtựchốt. Audit/kếhoạch core-audit-20261007.md phânbiệt triểnkhai/nghiệmthu và phase0–8mới với auditgiaiđoạncũ. Chưatriểnkhai source trong lượt audit.

## C11 — đóng/mở chi nhánh, phê duyệt 13/10/2026

Người dùng duyệt A-D01/A-D02: khi chi nhánh INACTIVE, chỉ chặn quote và đơn mới. Đơn đã tồn tại, kể cả PENDING, tiếp tục được xác nhận/giao/nhận/hoàn tất theo quyền và state machine hiện hành. Không tự hủy đơn cũ. Quyết định số chi nhánh ACTIVE tối thiểu và bảo toàn cấu hình đang chờ xác nhận riêng; chưa triển khai endpoint đổi trạng thái.

### C11-A1 — chính sách được duyệt13/10/2026

Người dùng duyệt A-D03/A-D04: không giới hạn số chi nhánh ACTIVE tối thiểu, cho phép tất cả INACTIVE. Đóng/mở giữ nguyên xe/vị trí, tuyến/fee/enabled, phân công Staff và dữ liệu đơn; không tự điều chuyển, hủy hoặc xóa. A-D01/A-D02 giữ hiệu lực: đơn cũ tiếp tục xử lý theo quyền/state machine, chỉ chặn quote và đơn mới. A1 thực hiện API status/version và rename giữ status; race với quote/create thuộc A2, UI thuộc A3, E2E toàn phạm vi thuộc A4.

## C12-1 — báo cáo vận hành, phê duyệt13/10/2026

Người dùng đồng ý4chỉ số: đơn tạo trong khoảng kèm trạng thái hiện tại, đơn hoàn tất theo historyCOMPLETED, số hóa đơn phát hành và tổng giá trị hóa đơn (không tiền đã thu). Ngày Asia/Ho_Chi_Minh, khoảng inclusive tối đa366ngày, mặc định tháng hiện tại; chưa thêm chi nhánh/biểu đồ/tăng trưởng. Contract tại [operational-reports](../modules/operational-reports.md). Quyết định cho phép chuẩn bị API C12-2 theo contract khi được yêu cầu, không xác nhận endpoint đã triển khai/nghiệm thu. Không thay đổi policy vận hành/payment/DB gốc.
