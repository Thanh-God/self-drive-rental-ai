# C11 — kế hoạch chi nhánh và địa điểm

Ngày13/10/2026. Trạng thái **IN PROGRESS: C11-L, C11-A1 và C11-A2 PASS scoped; còn A3/A4**. Kế hoạch ban đầu và audit giữ bên dưới; cập nhật thực thi ở cuối tài liệu.

## Baseline và phần giữ lại

- Workspace `E:\AI\BERT_Project\codepython\KLTN`, branch `update-20261012-0920`, HEAD trước lập kế hoạch `d770c2e8136709ba4dbb478c3abbb32bd1e43c98`.
- Giữ thay đổi có sẵn tại `docs/architecture/development-workflow.md` ngoài commit.
- C10A tiện nghi và C10B ảnh/gallery/Admin/Urban đã DONE scoped; typography đã được nghiệm thu77tests và70browser assertions. Không giao lại khi dependency/source không bị tác động.
- Location được đồng đội triển khai độc lập trên `feature/location-catalog-20261012-02`, remote HEAD `790cc82b7287c0bf4242bf829235c21f66fa713a`, fork từ `50529194d132feae9833ebb67082b65660e42cb6`. Dùng source này làm đầu vào C11-L, không viết lại module đã có. Xem [review nhánh](../modules/location-catalog-review-20261013.md).
- Schema đã có branches/status/version và location/categories. Không sửa V1/V2, thêm schema.sql hoặc tạo bảng dự phòng.

## Hai phạm vi, triển khai tuần tự

### C11-L — hoàn thiện và tích hợp catalog địa điểm

L0: đóng finding LOC-R01 về form sửa loại địa điểm. Actual tại ApiLocationsPage.jsx:213 chỉ copy `revision` vào draft, trong khi submit dòng77 đọc `expectedRevision`; backend yêu cầu64hex. Cần map rõ revision của bản đọc sang expectedRevision của request và bổ sung mounted test: sửa category thành công;400 giữ input; stale409 rồi chọn/tải bản mới và PUT revision mới. Không hạ assertion hoặc thay DTO backend để che lỗi client.

L1: bổ sung bàn giao có SHA, status/hash, command/exit và evidence source cuối. Ngưỡng nghiệm thu:

- Backend verify và actual MySQL isolated: category/location create201, read/update200, validation400, notfound404 theo endpoint, duplicate/stale409, Guest401 và USER/STAFF403; rejection không ghi. Tọa độ0,0 và biên±90/±180 hợp lệ; vượt biên/>7decimal bị từ chối. Rename category giữ FK và cập nhật tên hiển thị; INACTIVE vẫn được Admin đọc. Không DELETE.
- Concurrent update cùng revision chỉ một lần ghi thành công; stale response không làm UI báo thành công. Cần positive recovery sau409, không chỉ quan sát lỗi.
- Frontend tests/lint/demo+API build source cuối; actual desktop browser trên backend/MySQL thật cho tạo/sửa category, tạo/sửa location, refresh persistence, pending, validation, stale/recover, empty/error/retry và RBAC. H2 hoặc mocked DOM không thay MySQL/browser gate.
- Runner/evidence riêng, kiểm fixture marker và cleanup; dữ liệu gốc33385/3306 không dùng cho test ghi. Giữ raw evidence; không đếm test thiếu/skipped là PASS.

L2: sau khi L0/L1 đạt, chuẩn bị tích hợp hunk nhỏ. Merge preview hiện có conflict tại `frontend/src/routes/AppRoutes.jsx`; phải giữ `/admin/catalog`→ApiVehicleCatalogPage, `/admin/branches` hiện có và chỉ nối `/admin/locations`→ApiLocationsPage cùng import. Giữ demo route LocationsPage, ADMIN guard và toàn bộ C8–C10. Không chọn toàn file từ một phía để giải conflict.

Tích hợp Git thật chỉ thực hiện sau yêu cầu tiếp theo của người dùng. Sau tích hợp, chạy location gates và regression dependency bị tác động trên source/JAR của nhánh hiện tại; không coi PASS trên baseline cũ là PASS của bản tích hợp.

Source dự kiến khi triển khai: location controller/service/repository/entity/tests hiện có; `frontend/src/api/locations.js`, ApiLocationsPage và tests; AppRoutes hunk tích hợp; tài liệu module/result và runner riêng nếu thiếu. Không sửa auth/JWT, branch, booking, AI/Map hoặc shared frontend dependency ngoài finding có bằng chứng.

### C11-A — trạng thái đóng/mở chi nhánh

Hiện BranchInput chỉ nhận name/address/version; BranchService.save luôn gán ACTIVE. Đọc fee/active đã chặn chi nhánh INACTIVE cho quote/create, nhưng chưa có API/UI đổi trạng thái và chưa chứng minh race khi đóng đồng thời với tạo đơn. Đây là phần cần triển khai mới sau chốt chính sách.

Phương án đề xuất, **chưa được phê duyệt**:

- ADMIN đổi ACTIVE↔INACTIVE bằng endpoint riêng, ví dụ `PUT /admin/branches/{id}/status` với status và expectedVersion bắt buộc; version cũ409. Sửa tên/địa chỉ giữ status, không tự mở lại.
- INACTIVE ngừng nhận đơn mới tại điểm nhận hoặc trả. Backend xác minh quote/create; stale UI không vượt được kiểm tra. Không tự hủy đơn cũ, chuyển xe, xóa tuyến hoặc thu hồi Staff assignment.
- Đơn đã tồn tại tiếp tục được actor đúng quyền xử lý theo chi nhánh đã lưu, nếu người dùng chọn chính sách này. Snapshot hợp đồng/hóa đơn không bị viết lại khi đổi tên/status.
- Mở lại không tạo lại xe/tuyến/Staff; việc tuyến nào được dùng vẫn theo route.enabled và fee đã cấu hình.
- Đóng vs create/update đồng thời phải có thứ tự khóa và kiểm trạng thái thống nhất, tránh đơn mới commit sau khi trạng thái đóng đã thắng. Không dùng client timestamp hay chỉ disabled button làm bằng chứng.

Các quyết định cần người dùng chốt trước TASK C11-A:

| ID | Cần chốt | Đề xuất để xem xét |
|---|---|---|
| A-D01 | Có cho đóng khi còn PENDING/CONFIRMED/IN_PROGRESS/RETURNED? | Dừng đơn mới, cho xử lý đơn cũ; hoặc từ chối đóng tới khi hết công việc |
| A-D02 | PENDING đã tạo trước đóng có được xác nhận? | Cho tiếp tục nếu chọn bảo toàn đơn cũ; cần test rõ |
| A-D03 | Tối thiểu bao nhiêu chi nhánh ACTIVE? | Mốc2 trong audit là phương án cần quyết định, chưa tự áp dụng |
| A-D04 | Xe đang ở chi nhánh INACTIVE và tuyến liên quan | Giữ dữ liệu/vị trí/tuyến, chặn đơn mới; không tự điều chuyển/disable hàng loạt |

Source dự kiến: BranchController/Service và repository khóa; caller quote/create của BookingService chỉ khi cần xử lý race; ApiBranchesPage/form trạng thái; backend/frontend tests và runner riêng. Không thêm bảng/migration nếu contract dùng status/version hiện có.

Gate A: actual MySQL close/open/stale/RBAC/race; bảo toàn dữ liệu đại diện đơn cũ/xe/tuyến/Staff/Flyway; rename không reopen; UI loading/error/pending/400/409/reload; quote/new booking ở chi nhánh đóng bị từ chối đúng cause; tiếp tục công việc cũ đúng chính sách đã duyệt. Test race dùng latch/fixture clock phù hợp, không chờ vòng lặp hoặc sửa DB người dùng.

## Trình tự và điều kiện hoàn tất

1. Giữ C10 đã đạt và source đồng đội; đóng LOC-R01 và thiếu evidence trên đúng nhánh location.
2. Nghiệm thu C11-L độc lập, rồi tích hợp có kiểm soát và nghiệm thu bản tích hợp.
3. Chốt A-D01..04; chia A thành contract/backend rồi UI/E2E theo một phạm vi mỗi lượt.
4. C11 DONE khi location bản tích hợp và branch status đều đạt mandatory gates. Hiện C11 chưa triển khai trên nhánh chính.

Kế hoạch này không giao C12/report, C13/hardening, C14/full-core acceptance, AI/Map/payment hoặc mobile. Không tạo prompt cho toàn backlog. Khi người dùng yêu cầu bàn giao mới tạo TASK từng lượt, commit/evidence/HANDOFF và ACCEPTANCE theo quy trình KLTN.

## Thực thi C11-L —13/10/2026

Người dùng yêu cầu bắt đầu C11 và tích hợp location. Codex A tích hợp lịch sử remote790cc82 bằng merge hai parent, giải AppRoutes giữ catalog xe/branches/demo/ADMIN, sửa LOC-R01 bằng ánh xạ category.revision sang expectedRevision và thêm mounted regression400/409/recovery. Không sửa V1/V2, auth, package/dependencies hoặc DB gốc.

Source cuối: frontend79/79tests, lint, API/demo builds exit0; backend verify133reported/121executed/12optional skips,0failure/error; location isolated MySQL6/6,0skip. Actual JAR HTTP category race200+409/no-write/FK/recovery và browser22assertions trên schema fresh trong cùng fixture, desktop1280/1440/1920. Browser có empty thực từ MySQL, abort GET có chủ đích/retry thật, pending real response,400,409/recovery,CRUD,refresh,locationrace,ADMIN routes/USER guard. 4runner refusal testsPASS. Kết quả scoped, không xác nhận toàn hệ thống hoặc adverse cleanup chưa test.

Evidence/TASK/HANDOFF/ACCEPTANCE: `.runtime/coordination-c11-location-integrate-20261013/`; runner versioned `scripts/coordination/c11-location/`. Owned Java/Node/container đã dừng, volume KEEP; không push, không sửa dirty development-workflow.md.

C11-A: A-D01/A-D02 đã được duyệt: giữ đơn cũ, cho xác nhận/giao/nhận/hoàn tất theo quyền, chỉ chặn quote/đơn mới. A-D03 số ACTIVE tối thiểu và A-D04 giữ cấu hình vẫn chờ câu trả lời thứ2; chưa triển khai endpoint status. C11 tổng thể PARTIAL, không DONE.

## Chia phần còn lại thành 4 lượt —13/10/2026

Baseline chia việc: HEAD860ea05f902bfda545b1eefa4114bf74c0e04cb7. C11-L đã PASS scoped; không giao lại location hoặc C10 khi source/dependency không đổi. Bốn lượt dưới đây làm tuần tự; chưa tạo TASK triển khai hoặc gửi cho agent khác.

| Lượt | Phạm vi và đầu ra | Tiêu chí nghiệm thu | Phụ thuộc |
|---|---|---|---|
| C11-A1 | Chốt A-D03/A-D04; cập nhật decisions/contract. Backend API ADMIN đổi ACTIVE/INACTIVE với expectedVersion; sửa tên/địa chỉ giữ status, create mặc định ACTIVE. Tests và tài liệu API. | MySQL close/open; version cũ409; input thiếu/sai400; Guest401/USER/STAFF403; rename không reopen; request bị từ chối không ghi. Chính sách min ACTIVE kiểm đúng quyết định đã duyệt. | Người dùng chốt số ACTIVE tối thiểu và bảo toàn xe/tuyến/Staff; A-D01/A-D02 đã duyệt giữ đơn cũ. |
| C11-A2 | Tích hợp trạng thái với quote/create booking; thứ tự khóa nhất quán khi đóng đồng thời tạo đơn. Giữ khả năng xử lý đơn cũ theo quyền/state machine. | MySQL chặn quote/đơn mới nếu pickup hoặc return INACTIVE; race có thứ tự thắng rõ và readback; đóng thắng thì không tạo đơn mới. Đơn đã tồn tại vẫn xác nhận/giao/nhận/hoàn tất hợp lệ. Giữ xe/tuyến/Staff/snapshot/history; rejection không ghi đơn/audit sai. | A1 PASS; chính sách đã chốt. Đây là lượt có khối lượng và rủi ro lớn nhất. |
| C11-A3 | Frontend ApiBranchesPage và API client: hiển thị trạng thái, đổi đóng/mở, pending guard, thông báo400/409 và tải lại bản mới. Giữ màn hình tuyến/Staff và demo hiện có. | Mounted tests loading/error/retry/pending/success/400/409/fresh recovery; quyền ADMIN; không báo thành công giả. Frontend test/lint/API+demo build PASS; không đổi toàn bộ giao diện. | A1/A2 PASS và contract ổn định. |
| C11-A4 | Browser E2E trên JAR/MySQL cô lập: Admin đóng/mở, User bị chặn đơn mới, Staff tiếp tục đơn cũ; bảo toàn dữ liệu. Nghiệm thu C11 và cập nhật tài liệu cuối. | Desktop1280/1440/1920; ca chính/âm/stale/recovery/persistence/RBAC; SQL readback; source/JAR hashes; cleanup owned/fixture KEEP. Tái chạy suites bị tác động, không chạy lại location/C10 vô cớ. Chỉ DONE khi mọi gate bắt buộc đạt. | A1–A3 PASS; source cuối đã đóng băng. |

Mỗi lượt tạo thư mục coordination và TASK riêng trước triển khai; ghi HANDOFF/ACCEPTANCE/evidence cùng lượt, commit source/tests/docs tương ứng. Không giao cả bốn lượt trong một prompt. Lượt sau lấy HEAD/hash đã nghiệm thu của lượt trước; thiếu quyết định hoặc evidence thì ghi PARTIAL/BLOCKED đúng phạm vi. Không push hoặc ghi DB gốc theo kế hoạch này.

## C11-A1 — thực thi và nghiệm thu13/10/2026

A-D03/A-D04 đã được người dùng duyệt: không giới hạn số chi nhánh ACTIVE tối thiểu; đóng/mở giữ xe/vị trí/tuyến/phân công Staff/đơn cũ, không tự điều chuyển/hủy/xóa. Các ghi chú chờ quyết định ở phần lịch sử được thay bằng phê duyệt này; A-D01/A-D02 giữ nguyên.

C11-A1 DONE scoped: ADMIN PUT /api/v1/admin/branches/{id}/status với ACTIVE/INACTIVE và expectedVersion bắt buộc không âm; record lock + current version; stale409, validation400,missing404,Guest401,USER/STAFF403. Sửa tên/địa chỉ giữ status; create ACTIVE; cùng status và version hiện tại là no-op, version cũ vẫn409. Không thêm migration/bảng/dependency.

Backend verify137reported/125executed/12optionalSKIP,0failure/error; targeted actualHTTP MySQL4/4noSKIP. Kiểm được đóng hết ACTIVE,rename khôngreopen,no-write sauerror/stale, bảo toàn8nhóm dữ liệu gồm xe/tuyến/Staff/đơn/history/contracts/invoices/Flyway. JAR182class/resource entries khớp byte compiled tree dùng HTTP tests; source manifest trước/sau không drift. Runner guard1test/2subcases refuseexisting/outside, không claim toànadversecleanup. Fixture exactidentity đã dừng/volumeKEEP; DB gốc khôngtestghi. Evidence TASK/HANDOFF/ACCEPTANCE: `.runtime/coordination-c11-a1-codexa-20261013/`; contract docs/modules/branch-status.md.

Tiếp theo A2: quote/create vs close race và workflow đơn cũ; A3: UI đóng/mở; A4: browserE2E/đóngC11. Chưa triển khai ba lượt này, C11 tổng thể PARTIAL. Frontend/location/C10 source không đổi, giữ PASS cũ khi dependency liên quan không bị tác động; chưa gọi backend JAR mới là browserPASS.

## C11-A2 — thực thi13/10/2026 — PASS scoped

Finding A2-01 đóng bằng ordered distinct branch locks trong giao dịch quote/create và typed BookingRoute DTO, không trả thêm entity mutable qua module. Close dùng cùng record lock. Finding A2-02 đóng bằng bỏ ACTIVEbranch check khi xác nhận đơn cũ; giữ permission/GPLX/vehicle/schedule/state/version. Không đổi migration/dependency/productionclock/frontend.

Backend verify143reported/129executed/14SKIP,0failure/error:12optional cũ và2race chỉ dành MySQL. Targeted MySQL10/10noSKIP (A2six+A1four); actual HTTP negatives/positives và lifecycle closedbranch; actual transactional service race2ca đều có MySQLdata_lock_waits readback. Close thắng:no booking/historywrite,409 đúng cause. Create thắng:close chờ commit,bookingcũPENDING được confirm. Snapshot/route/Staff/Flyway preservation và permissions/GPLX/time/version vẫn đạt. JAR183entries khớp compiled tree dùng tests; inputsourcehash freeze trước/sauPASS. Fixture đã dừng/volumeKEEP; không test ghi DBgốc hoặc push.

Evidence/TASK/HANDOFF/ACCEPTANCE tại `.runtime/coordination-c11-a2-codexa-20261013/`; runner `scripts/coordination/c11-branch-booking/`. H2raceSKIP không làPASS; nativeMySQLthựcthiđủ. A3UI và A4browserE2E bảnbackendmới chưa thực hiện, C11 tổng thể PARTIAL. Các ghi chú chưa triển khaiA2 trước đây là lịch sử, được cập nhật bởi kết quả này. Không chạy lại location/C10frontend không bị đổi vô cớ.
