# C10B — ảnh xe API, gallery và nguồn ảnh — kế hoạch 13/10/2026

Trạng thái hiện tại: DONE scoped — backend, frontend desktop và 17 ảnh có hồ sơ nguồn đã hoàn tất ngày 13/10/2026. Xem [nghiệm thu giao diện](c10b-ui-acceptance.md). Nội dung kế hoạch ban đầu phía dưới giữ để audit; các ghi chú “chưa triển khai/chưa giao” mô tả thời điểm lập kế hoạch, không phải trạng thái hiện tại.

## Baseline và phạm vi

- Workspace `E:\AI\BERT_Project\codepython\KLTN`, branch `update-20261012-0920`, HEAD trước lập kế hoạch `83aa0a30298b60e8997046c3bdd50292912fb0cd`. Giữ thay đổi có sẵn tại `docs/architecture/development-workflow.md` ngoài commit.
- C10A backend và UI đã PASS scoped, tham chiếu hai ACCEPTANCE tại `.runtime/coordination-c10a-codexa-complete-20261012-212639/` và `.runtime/coordination-c10a-ui-codexa-complete-20261012-230616/`. Báo cáo backend lịch sử còn ghi UI pending; biên bản UI sau đó đã đóng phạm vi này. Không sửa báo cáo cũ.
- C10B chỉ quản lý URL ảnh, thứ tự, attribution; đọc ảnh thật qua API, card/home/list/detail gallery, editor Admin và hồ sơ nguồn ảnh. Không sửa giá, lịch, booking/state machine, quyền Staff, chứng từ, migration hoặc thêm upload/cloud service.
- Chỉ desktop là gate bắt buộc theo chỉ đạo mới: 1280/1440/1920px, chuột và bàn phím. Giữ lịch sử mobile đã kiểm thử; không triển khai hoặc chạy mobile suite riêng trong phạm vi này.
- Mốc thị giác: Urban Lifestyle Mobility, homepage draft `f9aad8bd-e9b0-457d-9fd1-219b60ed8bef`, nền xám ấm `#E4E0D8`, surfaces `#EEEBE4`, cam/charcoal và kiểu chữ Urban. Luxury là lịch sử không active. Draft Superdesign không chứng minh source frontend hoặc giấy phép ảnh đã hoàn thành.
- Chỉ áp dụng card/gallery/editor và màu liên quan cần thiết; chuyển toàn homepage/list/booking sang bố cục mới, tích hợp font ngoài hoặc redesign mọi page là phạm vi riêng. Không biến C10B thành triển khai trọn bộ mockup.

## Findings cần đóng

| ID | Actual từ source | Expected | Kiểm tra quyết định |
|---|---|---|---|
| B01 | Public vehicle DTO có amenities nhưng chưa có images | Additive typed images, đúng xe và thứ tự | HTTP/SQL exact ID, URL, attribution/order; query count |
| B02 | API VehicleVisual không dùng demo lookup; thiếu URL thì placeholder | Card ảnh đầu, detail gallery/credit; fallback trung thực | Browser naturalWidth, đổi ảnh/order, broken image |
| B03 | Chưa có editor media Admin | Add/edit/reorder với revision/atomicity/RBAC | HTTP/MySQL race, rollback, no-op, browser pending/409 |
| B04 | Demo attribution chỉ là khai báo, không xác nhận quyền dùng từng ảnh | 17–30 ảnh thật, khác nhau, đúng mẫu xe, nguồn/quyền được đối chiếu | License registry, hash, nguồn gốc, mapping và readback |

DB đã có `vehicle_images(id,vehicle_id,url VARCHAR500,sort_order INTEGER,attribution VARCHAR1000,UNIQUE(vehicle_id,sort_order))`. Không sửa V1/V2, không thêm bảng. SQL runtime không đưa vào Git.

## Ba lượt triển khai tuần tự — chưa giao

### B1: backend media và MySQL

Public list/detail thêm `images:[{id,url,sortOrder,attribution}]`, [] khi không có; sort theo sortOrder rồi ID. Đọc theo tập vehicle IDs, không query riêng từng xe/ảnh. DTO write thông tin xe không được ngầm ghi/xóa images.

Contract đề xuất để TASK sau chốt:

- ADMIN GET `/api/v1/admin/vehicles/{vehicleId}/images` → `{images,revision}`.
- POST cùng path thêm `{url,attribution,expectedRevision}`; backend cấp ID/order.
- PUT `/{imageId}` sửa URL/attribution; PUT `/order` nhận `{imageIds,expectedRevision}`, exact permutation toàn bộ IDs của xe.
- Khóa Vehicle trước, transaction validate → compare revision → mutate. Revision SHA256 từ canonical ordered ID/URL/order/attribution, không đổi version xe; digest không chứng minh ABA/history. No-op cùng nội dung/thứ tự: 200, zero DML, revision giữ nguyên.
- Missing/malformed revision và input 400; stale 409; xe/ảnh không tồn tại hoặc ảnh thuộc xe khác 404; Guest401, USER/STAFF403. Mọi rejection không ghi.
- Reorder xử lý UNIQUE bằng vùng order tạm hợp lệ, có kiểm bounds/overflow, trả thứ tự liên tục từ 0 sau thành công. Không drop constraint; rollback sau mutation thật phải phục hồi đầy đủ, không còn order tạm.
- URL đề xuất HTTPS hợp lệ hoặc root-relative trong `/media/vehicles/`; giới hạn500; reject javascript/data/file, protocol-relative, credentials, control chars, traversal và escaped traversal. Backend không fetch URL. Chốt quy tắc query/fragment/canonicalization trước test, không tự đổi sau để đạt PASS.
- Attribution plain text tối đa1000; đề xuất normalize blank→null, không HTML. Hồ sơ license đầy đủ ở asset registry, không nhồi toàn bộ vào DB vượt giới hạn.
- Không DELETE/soft-delete hoặc replace-all ngầm xóa ảnh; chính sách gỡ ảnh còn mở.

Source dự kiến: dedicated `VehicleImageController/Service/Repository`, VehicleService/View, tests `VehicleImageHttpServerTest`, runner trong `scripts/coordination/c10-vehicle-media/`. Dùng dependency đã nghiệm thu, kiểm manifest/hash và provenance khi sửa.

Gate B1: JDK21 `mvnw.cmd verify`, actual MySQL HTTP/SQL ca chính/âm, race hai payload khác cùng revision một200/một409; append/edit/reorder/no-op; crossvehicle/old vehicle edit/snapshot preservation; rollback sau partial mutation; bounded query count. Mandatory MySQL không skip. Chạy lại regression amenities/catalog vì shared VehicleService/DTO bị tác động; không triển khai lại C10A.

### B2: frontend desktop card/gallery/editor

Source dự kiến: `frontend/src/api/vehicleImages.js`, `components/vehicle/VehicleGallery.jsx`, editor riêng dưới components/vehicle, `VehicleCard.jsx`, `ApiScreens.jsx`, `ApiManagementScreens.jsx`; tests DOM actual imported source. Không di chuyển pages/API hàng loạt.

- normalize giữ images từ API; không map ảnh bằng demo ID/name. Card ảnh order đầu; gallery chọn ảnh, credit đổi cùng ảnh, ảnh đầu không lazy nếu ảnh chính above-the-fold; các ảnh còn lại lazy/thumbnail phù hợp.
- Broken/no-image fallback có chữ đúng nghĩa; API lỗi vẫn error/retry, không thay dữ liệu demo. URL và attribution không render HTML. Selection đổi xe/reset ảnh không giữ stale URL; late response của xe cũ không gây thông báo thành công ở xe mới.
- Admin xe đã lưu: add/edit/reorder riêng; pending synchronous chặn submit lặp,400 giữ input;409 không false success, reload fresh rồi submit revision mới. Staff chỉ đọc.
- Kiểm tra focus, contrast, ảnh không méo, credit đọc được, không overflow desktop; dùng mốc Urban xám ấm để giảm nền trắng rộng. Bản thiết kế không cấp quyền invent tính năng.

Gate B2: `npm test`, lint, build demo/API; DOM ca chính/âm/regression actual components; backend/MySQL thật trong browser, ảnh fixture deterministic cùng origin có bytes/hash, naturalWidth>0, ảnh/order/credit API↔SQL; permissions và pending/400/409/recover; ảnh lỗi và đổi xe khi request chậm. Chụp desktop trước/sau. Internet không phải dependency của browser PASS.

### B3: bộ ảnh có quyền sử dụng và tích hợp catalog

- Mục tiêu 24 ảnh thật khác nhau, trong khoảng người dùng yêu cầu17–30. Dự kiến 8 ảnh/mẫu Toyota Vios, Hyundai Accent, Mitsubishi Xpander; điều chỉnh phân bổ theo catalog thực và ảnh có quyền phù hợp. Đây là số ảnh, không tạo24 xe. Không đủ17 ảnh hợp lệ thì PARTIAL, không dùng trùng bytes/crop giả số lượng hoặc ảnh sai mẫu để đủ quota.
- Đọc trang nguồn từng file và điều khoản license; ưu tiên nguồn cho phép tái sử dụng rõ ràng hoặc ảnh người dùng sở hữu có xác nhận quyền. URL tìm kiếm/ảnh Google/dealer và ghi chú demo không là bằng chứng quyền. Chưa kiểm license trong lượt kế hoạch này.
- Registry dự kiến `frontend/public/media/vehicles/licenses.json`: source asset page, tác giả, license/version/URL, điều kiện credit và phái sinh, ngày xác minh, filename/hash, mẫu/đời xe và mô tả thay đổi. Lưu evidence nguồn ở runtime; credit công khai phù hợp đi kèm asset. Không coi không watermark là được phép.
- Tối ưu WebP/JPEG có kích thước/card/thumbnail hợp lý, giữ bản nguồn/quyền khi điều khoản yêu cầu; không tải font/video mới hoặc lưu một ảnh nhiều bản vô cớ. Chốt budget dung lượng sau pilot3ảnh, đo bytes/network trước khi bổ sung cả bộ.
- Ảnh nguồn khác chiếc xe thuê: ghi rõ **Ảnh minh họa mẫu xe**, không tuyên bố là chiếc xe có biển số đang thuê. Matching dựa mẫu/đời/variant đã xác minh, không chỉ filename. Gallery fallback khi chưa có ảnh đúng mẫu.
- Fixture cô lập trước: import idempotent có mapping vehicle ID↔photo registry, dry-run diff, không reseed/reset dữ liệu. Chưa ghi DB gốc trong lượt này. Trước áp dụng catalog người dùng phải chốt exact target/IDs, backup/readback và kế hoạch bounded writes; không trỏ test vào33385/3306.

Gate B3: count17–30, uniquehash, license registry đầy đủ và link hỗ trợ từng claim; mẫu đúng và nhãn minh họa; assets thực tải được; HTTP/SQL mapping/order/credit, idempotency rerun không thêm bản trùng; desktop browser deterministic. Quyền ảnh là gate riêng, test tải ảnh thành công không chứng minh hợp pháp.

## Quyết định/giới hạn và điều kiện đóng

1. API URL/revision/blank-attribution/reorder chốt trong TASK B1 trước code; no-delete hiện là giới hạn, không chặn add/edit/reorder.
2. Phông chữ Urban và giấy phép phân phối font chưa kiểm trong lượt này; không bắt buộc tải font để hoàn thành media. Không tự thêm provider/upload/credit tốn phí.
3. 24 ảnh là mục tiêu phân bổ, không claim đã có hoặc đã kiểm license. Chưa phê duyệt mở rộng số mẫu xe hay tự sửa thông tin xe để khớp ảnh.
4. Chưa bàn giao; chỉ khi người dùng yêu cầu mới tạo TASK từng lượt và prompt tương ứng, agents làm tuần tự. Mỗi lượt có commit riêng/evidence/HANDOFF, Codex A ACCEPTANCE độc lập; không gửi toàn backlog trong một prompt.
5. Giữ PASS cũ bằng đối chiếu hash/source; tái chạy gates bị tác động khi source đổi. Source freeze, caller env, owned cleanup/provenance theo skill KLTN. Fixture riêng, evidence giữ nguyên; không tạo container lặp vô cớ, không prune.
6. C10B DONE khi B1/B2/B3 mandatory gates cùng đạt source cuối, asset rights rõ, artifacts/readback đầy đủ. Whole C10 chỉ đóng khi C10A retained/relevant regression và C10B đều đạt. Không suy toàn hệ thống PASS từ việc đóng C10.

## Kết quả triển khai 13/10/2026
Người dùng mở rộng phạm vi sang homepage/list/detail/my-bookings theo Urban và duyệt gắn 17 ảnh vào v1/v2/v3 (6 Vios, 6 Xpander, 5 Accent). B1 retained source/JAR đã nghiệm thu; B2/B3 DONE scoped theo docs/ui/c10b-ui-acceptance.md và .runtime/coordination-c10b-ui-codexa-20261013/ACCEPTANCE.md. Target 24 ban đầu được thay bằng 17 đã duyệt, vẫn trong17–30. Không chuyển Luxury, thêm tính năng prototype, mobile gate, upload/delete/provider hoặc reset/reseed DB.
