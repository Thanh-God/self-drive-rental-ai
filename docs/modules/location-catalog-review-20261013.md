# Review nhánh location catalog — 13/10/2026

Kết luận **PARTIAL, chưa ready** tại remote SHA `790cc82b7287c0bf4242bf829235c21f66fa713a`. Codex A kiểm tra snapshot bằng git archive, giữ workspace chính nguyên trạng; không checkout/merge/push hoặc sửa nhánh đồng đội.

## Git và remote

Repo origin: https://github.com/Thanh-God/self-drive-rental-ai.git.

| Hạng mục | Kết quả |
|---|---|
| Nhánh đã push | feature/location-catalog-20261012-02 tồn tại; HEAD790cc82 |
| Tên cũ feature/location-catalog-20261012 | Không có trong refs remote được đọc |
| Baseline | 50529194; feature có5commit riêng,16file thay đổi |
| Nhánh máy chính | update-20261012-0920 tại d770c2e trước review; không chuyển sang feature |
| Độ lệch so với máy chính | 42commit chỉ phía máy chính,5commit chỉ phía feature tại baseline review; chưa tích hợp |
| Remote nhánh tích hợp | 50529194, vẫn ở baseline đã công bố; không chứa feature commits |
| Remote master | 3a8596b, khớp remote-tracking local đã có |
| Ubuntu local HEAD/status | NOT VERIFIED: không truy cập worktree máy Ubuntu; remote không chứng minh local sạch/đồng bộ |
| backend/mvnw |790cc82 commit quyền thực thi100644→100755, nội dung không đổi; trạng thái local Ubuntu vẫn chưa xác minh |

5commit:39bbe782(categoryAPI),c21a2bc8(locationAPI),a31c65a1(seed password testMySQL),ecfb2ad3(APIUI/routes),790cc82b(mvnw executable). Nội dung trong16files đúng nhóm location + route hookup + wrapper mode; không có migration/auth/booking/C8–C10 bị sửa trong feature diff. Không suy lịch sử force-push chỉ từ trạng thái hiện tại; chưa thấy ref tích hợp/master bị thay bằng feature HEAD.

Merge preview với d770c2e có content conflict `frontend/src/routes/AppRoutes.jsx`. Nhánh feature còn dùng baseline cũ cho `/admin/catalog`; phải giữ catalog xe/branches của máy chính khi giải conflict. Merge-tree chỉ viết object preview, không cập nhật HEAD/working tree.

## Kiểm chứng và giới hạn

Artifact: `.runtime/coordination-c11-plan-location-review-20261013/evidence/`.

| Hạng mục | Kết quả | Command/exit | Artifact |
|---|---|---|---|
| Remote refs | PASS |git ls-remote/0 |remote-heads.txt |
| Source snapshot | PASS canonical text16files |git archive/show +hash readback/0 |feature-source-hashes.json |
| Frontend suite của nhánh | PASS41/41,0skip |node --test11trackedfiles/0 |location-all-frontend-tests.log |
| Lint | PASS |npm run lint/0 |location-lint-b.log |
| API/demo build | PASS |npm run build/0both |location-api-build-b.log;location-demo-build.log |
| Backend location | PASS6/6 trên H2,0skip |mvnw.cmd -Dtest=LocationCategoryIntegrationTest,LocationIntegrationTest test/0 |location-backend-h2.log;TEST-Location*.xml |
| Reviewer category update | FAIL |node --test locationCategoryReview.test.js/1 |location-category-regression-b.log |
| MySQL integration/browsersmoke | NOT VERIFIED |Không có evidence published phù hợp; chưa tái chạy |— |
| GitHub CI | NOT VERIFIED |API status/check-runs:0contexts,0runs |github-status.json;github-check-runs.json |
| Tích hợp route | BLOCKED |git merge-tree/1 |merge-preview.txt |

Snapshot sử dụng dependency frontend có package.json/lock Git blob trùng máy chính; chỉ junction node_modules, không cập nhật dependency. Git archive trên Windows đổi EOL của mvnw sang CRLF; nội dung canonical LF đã đối chiếu, không tuyên bố rawbytes toàn snapshot bằng Gitblob. Ca reviewer được thêm trong runtime riêng;16file feature giữ nội dung, không thêm ca này vào suite gốc để đánh đồng PASS/FAIL của tác giả. Thử đầu chưa có dependency do sandbox chặn junction được giữ lại như environment failure; sau junction chạy thành công bộ test gốc và tái hiện lỗi thật.

## Findings còn mở

**LOC-R01 — P1 — ApiLocationsPage.jsx:213 và:77; LocationCategoryController.java:34.** Actual: edit category chỉ `setCategoryDraft({...category})`, DTO đọc có `revision`; submit lại lấy `categoryDraft.expectedRevision`, nên JSON PUT thiếu trường bắt buộc. Reviewer mounted assertion nhận `undefined`, expected64hex của response. Controller bắt buộc@NotBlank/Pattern, nên request này không đáp ứng contract cập nhật. Ảnh hưởng: người dùng không cập nhật được loại địa điểm qua form. Cần map rõ field và thêm regression update thành công/400/stale409/fresh recovery; không sửa validator để cho qua.

Phần source của assertion reviewer để tái hiện được lưu trong tài liệu này; dùng các helper thực trong `locationsManagement.test.js` của SHA đã chốt, thêm test riêng vào snapshot:

```javascript
resetRequests();
const container = await mount();
const category = { id: "cat-review", name: "Beach", revision: "a".repeat(64) };
await loadInitial([category], []);
await act(async () => container.querySelector('[role="tab"]:nth-child(2)').click());
await act(async () => container.querySelector('[data-testid="edit-category-cat-review"]').click());
await act(async () => container.querySelector("form").dispatchEvent(
  new dom.window.Event("submit", { bubbles: true, cancelable: true })));
const put = take("/admin/location-categories/cat-review", "put");
const payload = JSON.parse(put.config.data);
await act(async () => reject(put, 400, { message: "expectedRevision is required" }));
await unmountAll();
assert.equal(payload.expectedRevision, category.revision);
```

Response400 trong test này được điều khiển để giải phóng request/cleanup; bằng chứng FAIL là payload bị thiếu revision, không tuyên bố response giả là HTTP/MySQL proof.

**LOC-R02 — P1 readiness — evidence/handoff.** Branch không chứa tài liệu kết quả/module hoặc runner/bàn giao theo kế hoạch độc lập. GitHub CI không có run; ảnh báo cáo chat của đồng đội không thay source-bound MySQL XML/log/readback và browser evidence. H2 PASS ở reviewer không là MySQL PASS. Cần cung cấp hoặc tạo lại artifact trên source cuối sau fix.

**LOC-R03 — integration blocker — AppRoutes.jsx.** Preview conflict ở route catalog/locations/branches. Expected: giữ C9 catalog xe, route branches hiện có và thêm location API route trong ADMIN guard. Không thay toàn file bằng bản cũ của feature. Tích hợp và regression chỉ làm khi được người dùng yêu cầu.

DONE: module/API/UI source,5commits đã publish, suite gốc/lint/build và H2 targeted đạt. PARTIAL: form updatecategory còn lỗi, tài liệu/evidence chưa đủ. NOT VERIFIED: MySQL/browser, Ubuntu HEAD/status. BLOCKED: merge preview route. Chưa kết luận toàn nhánh PASS/ready và chưa đóng C11.

## Tiếp nối tích hợp —13/10/2026

LOC-R01 đã sửa trên nhánh tích hợp: category revision được đưa đúng vào expectedRevision. Mounted regression400/stale409/fresh recoveryPASS; frontend79tests/lint/demo/APIbuild, MySQL6tests và actualJAR/HTTP/browser22assertionsPASS scoped. AppRoutes giữ catalog xe/branches/demo/ADMIN. Ubuntu worktree không được đọc, không xác nhận sạch/sync ở máy đồng đội; remote790cc82 được giữ trong lịch sử merge, không push/ghi đè nhánh gốc. Xem `.runtime/coordination-c11-location-integrate-20261013/ACCEPTANCE.md` và docs/architecture/c11-plan.md. C11-A còn chờ quyết định; không suy toànC11DONE.
