# C12 — báo cáo vận hành và dashboard Admin

Ngày 13/10/2026. Trạng thái **DONE scoped: C12-1–5 đã đạt các gates của kế hoạch**. Các mục kế hoạch/lịch sử bên dưới được giữ để đối chiếu. Căn cứ UC-A05 (Nên có) và backlog core-audit C12; không mở rộng báo cáo tài chính nâng cao, AI/Map hoặc thanh toán online.

## Baseline và giới hạn

Workspace E:\AI\BERT_Project\codepython\KLTN; branch update-20261012-0920; HEAD 67a3d31e7f8a3ffdb0da190901eb661560b1e546. Giữ thay đổi có sẵn development-workflow.md. C11 DONE scoped; lỗi timeout hồ sơ vẫn PARTIAL, người dùng yêu cầu hoãn điều tra. Không coi lỗi này đã đóng; nếu nó tái hiện và chặn browser C12 thì ghi blocker riêng, không giả PASS.

Làm tuần tự, không tự giao cho agent khác. Không sửa DB gốc, migration đã áp dụng, trạng thái đơn, cách tính giá, snapshot hợp đồng/hóa đơn. Không tạo bảng báo cáo hoặc dependency/chart library trước khi chứng minh cần thiết. Dashboard demo và API tách biệt; không fallback API lỗi sang dữ liệu mẫu. Desktop là trọng tâm; giữ layout cơ bản không vỡ, chưa thêm giai đoạn thiết kế mobile riêng.

## Năm phần việc nhỏ

### C12-1 — định nghĩa chỉ số và contract

Đọc decisions, requirements, booking/invoice/branch contracts, entity và timestamp thật; kiểm tra DashboardPage, routes/Admin layout và nguồn demo hiện có. Lập bảng từng chỉ số: tên, đơn vị, nguồn, timestamp dùng lọc, trạng thái được tính/loại, phạm vi thời gian, xử lý khoảng rỗng và quyền. Ghi ví dụ expected từ dataset nhỏ có biên ngày.

Đề xuất tối thiểu: số đơn tạo trong khoảng theo createdAt và nhóm trạng thái hiện tại; số đơn hoàn tất theo thời điểm hoàn tất đã có nguồn đáng tin; tổng tiền hóa đơn phát hành trong khoảng theo timestamp hóa đơn. Không tự coi CREATED count là đơn hoàn tất, tổng hóa đơn là tiền thu, hay trạng thái hiện tại là trạng thái lịch sử tại ngày đã chọn. Nếu source thiếu timestamp cần thiết, giảm bộ chỉ số theo quyết định được duyệt, không suy đoán hoặc thêm cột tự phát.

Khoảng hiển thị Asia/Ho_Chi_Minh, query UTC [from,to), ngày kết thúc giao diện inclusive chuyển thành đầu ngày tiếp theo. Đề xuất chỉ lọc thời gian trong phiên bản đầu, chưa so sánh tăng trưởng/kỳ trước/chi nhánh nếu chưa chốt nhu cầu. Chốt giới hạn khoảng và query validation trước API.

Đầu ra: docs/modules/operational-reports.md với bảng metric, DTO/endpoint đề xuất, decision còn mở và dữ liệu kỳ vọng. Gate: được chốt định nghĩa và phạm vi trước C12-2; hiện các lựa chọn trên là đề xuất, không phải phê duyệt.

### C12-2 — API tổng hợp theo contract

Triển khai một phạm vi endpoint Admin chỉ đọc theo contract C12-1. Tái sử dụng ranh giới module và DTO có kiểu; không SQL/entity mutable xuyên module. Tổng hợp ở DB qua projection/query phù hợp, không load toàn bảng vào bộ nhớ. Kiểm tra role ADMIN ở backend; Guest401, USER/STAFF403; validate from/to và giới hạn đã duyệt, lỗi400 thay500.

Không trả email/điện thoại/GPLX hoặc danh sách dữ liệu cá nhân cho KPI. Không thêm module báo cáo, index hoặc migration nếu chưa đánh giá cấu trúc đang có và nhu cầu thực tế. Test ca dương/âm: khoảng hợp lệ, rỗng, đảo ngày, biên, quyền; đối chiếu công thức C12-1. Gate: backend verify và tests bắt buộc đạt, còn MySQL quyết định chuyển C12-3.

### C12-3 — kiểm chứng MySQL và tính đúng số liệu

Fixture cô lập riêng lượt, tái dùng đúng fixture của lượt khi sửa cùng lỗi; không chạm33385/3306. Dữ liệu đại diện đủ trạng thái, đơn ở hai phía biên thời gian, nhiều hóa đơn, snapshot giữ ổn định sau đổi tên/giá nếu liên quan. Chứng minh API khớp SQL readback và expected đã tính độc lập; query rỗng trả0, không null/fake KPI. Không tạo dữ liệu bằng cách bypass state machine mà lại tuyên bố workflow đạt.

Kiểm quyền HTTP thật; request bị từ chối không ghi. Thử khoảng lớn theo giới hạn đã chốt, kiểm truy vấn không N+1/không trả tất cả bản ghi; ghi latency và dataset, không tự tuyên bố benchmark production. Nếu các query có yêu cầu snapshot nhất quán thì chứng minh hoặc ghi giới hạn contract.

Đầu ra: runner source trong Git, evidence hash/query/JSON trong runtime riêng. Gate: zero fail/skip ở ca MySQL bắt buộc; backend source cuối/JAR khớp. Giữ fixture/cleanup theo chính sách hiện hành.

### C12-4 — dashboard Admin kết nối dữ liệu thật

API client tập trung, hook/page tái sử dụng layout Admin và design tokens hiện có. Hiển thị card đúng các metric được duyệt, đơn vị VND và khoảng thời gian rõ; form ngày và refresh. Loading/error/empty/retry, ngăn phản hồi cũ đè bộ lọc mới; không số ngẫu nhiên, +100%, chart giả hoặc nhãn đã thanh toán.

Ưu tiên card và bảng trạng thái đơn; chart chỉ thêm nếu giúp đọc dữ liệu và nằm trong scope đã chốt, dùng khả năng hiện có trước dependency mới. Không redesign homepage/customer pages. Không sửa backend nghiệp vụ trong phần UI.

Tests mounted: dữ liệu thật từ adapter, loading/retry, zero, server400/403/500, thay khoảng/out-of-order; frontend npm test/lint/demo+API build. Gate: source cuối đạt, browser thật chuyển C12-5.

### C12-5 — nghiệm thu tích hợp và tài liệu vận hành

Chạy backend/MySQL thật và desktop browser: Admin chọn ngày -> API -> card/bảng -> SQL expected; refresh giữ dữ liệu, khoảng rỗng, validation/retry và quyền USER/STAFF/Guest. Kiểm không ảnh hưởng đơn/chi nhánh/hóa đơn/snapshot, không đổi route demo/API. Mở rộng regression chỉ theo dependency bị tác động.

Tất cả suites bắt buộc của phạm vi/dependency phải đạt source cuối; skipped không PASS. HANDOFF/ACCEPTANCE riêng với command/exit/assertions/hashes/SHA, screenshot dashboard, hạn chế và cách tái chạy. Cập nhật README/frontend docs và audit kết quả thật; commit rõ phần mỗi lượt. Dừng đúng services do test tạo; fixture KEEP/archive/dọn chỉ theo chính sách đã kiểm chứng. Không tự push.

Gate: C12 DONE scoped chỉ khi C12-1–5 đạt và không còn finding chặn trong phạm vi. Chưa suy toàn project DONE; C13/C14 và lỗi timeout đang hoãn còn riêng.

## Thứ tự và khối lượng tương đối

C12-1 -> C12-2 -> C12-3 -> C12-4 -> C12-5. Phần2/3 nặng hơn do query và chứng minh số liệu; phần1 phải làm trước để tránh dashboard sai định nghĩa. Mỗi phần có TASK riêng khi được yêu cầu bắt đầu, baseline/hash mới và commit tương ứng, không tạo HANDOFF/ACCEPTANCE placeholder. Hiện chưa giao việc hoặc khởi chạy agent.

## Tiến độ C12-1 —13/10/2026

C12-1 DONE contract tại [operational-reports](../modules/operational-reports.md); người dùng duyệt4chỉ số/ngày366/defaultmonth và scope exclusions. Source historyCOMPLETED cóoccurred_at, PENDINGeffective expiry và InvoiceService JDBC đã đối chiếu; dữ liệu mẫu/biên thời gian/trạng thái/tiền/DTO/RBAC/gates được xác định. Chỉ kiểm tài liệu/source/số học, chưa API/SQL/browser proof. C12-2–5 chưa bắt đầu; các câu đề xuất/chờ chốt trong kế hoạch ban đầu là lịch sử, được thay bằng contract đã duyệt.

## Tiến độ C12-2 —13/10/2026

C12-2 DONE backend/H2 scoped: report API/typedaggregates/datevalidation/RBAC/readonly transaction; verify153reported139executed14skip0fail, reporttests4/4noskip. Không frontend/migration/deps/DBgốc/restartuserprocess/push. Provenance runtimecopy+JAR khớp sourcefinal. Chưa nativeMySQL/snapshot/performance/browser, không coi toàn C12DONE; chuyển C12-3 khi được yêu cầu.

## Tiến độ C12-3 —13/10/2026

DONE MySQL scoped:8/8native no skip,HTTPworkflow/invoiceSQLreadback/no-write/RBAC/biên ngày và concurrent snapshotold→new đạt. 10000bookings latency20–26ms local vớiinvoice/history0; khôngproductionSLA/đềxuấtindextựđộng. Verify139executed18skip không tínhPASS; native-required executed đủ. SourceJARhashmatch, fixturestoppedKEEP, DBgốc/servicesusergiữ. C12-4/5 chưa triểnkhai.

## Tiến độ C12-4 —13/10/2026

Dashboard API /admin riêng đã triển khai4cards/status table/datefilters/defaultVNmonth, BigIntVNDprecision, loading/error/empty/retry/no stale result theo useApiData. 116frontendtests/lint/demo/APIbuild đạt, khôngbackend/migration changes. C12-5browser đang chuẩn bị, chưa toànC12DONE. Khôngnạpvàobackenduserđangchạy/push/DBgốc.

## C12-5 và kết quả cuối —13/10/2026

DONE C12 scoped. Frontendfinal116tests/lint/demo/API, browser30realbackend/MySQLassertions/SQLno-write/desktopscreenshots/RBAC/zero/retry; nativeC12-3eight/hashmatch retained. Visualreview sửa nút Xembáocáo sangclassbtnđúng hiện có rồirerunfinalchecks. C12-4SHA99e6cf0, C12-5SHA ởACCEPTANCE .runtime/coordination-c12-ui-final-20261013/. NoDBgốc/push/restartuser; fixtureKEEP/ownedcleanup. TimeoutuserPARTIALhoãn/C13/C14/AIngoàiC12.
