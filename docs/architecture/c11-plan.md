# C11 — kế hoạch chi nhánh và địa điểm

Ngày13/10/2026. Trạng thái **IN PROGRESS: C11-L đã kiểm chứng bản tích hợp; C11-A chờ quyết định còn lại**. Kế hoạch ban đầu và audit giữ bên dưới; cập nhật thực thi ở cuối tài liệu.

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
