# C10B UI — Urban và ảnh xe, 13/10/2026

DONE scoped. Codex A trực tiếp triển khai theo người dùng, giữ backend C10B đã đạt bằng đối chiếu source/JAR; không điều khiển agent khác.

## Giao diện và contract

Homepage, danh sách xe, chi tiết xe và đơn thuê của tôi dùng nền xám ấm `#E4E0D8`, surface `#EEEBE4`, cam/charcoal của Urban v3. Bố cục và nội dung được thích nghi với dữ liệu nghiệp vụ hiện có, không đưa các tính năng mobile key, insurance, awards, payment hay AI/Map giả của prototype vào sản phẩm. Dùng system sans và Georgia/Times serif fallback có tiếng Việt; không phân phối font General Sans/Gambetta chưa xác minh quyền.

Card chọn ảnh đầu của API; gallery đổi ảnh và credit, reset khi đổi xe, ảnh chính eager và thumbnails lazy. API không fallback sang ảnh demo. Attribution là text; nguồn/giấy phép có trang công khai trong footer. Trạng thái ACTIVE là “Đang khai thác”, không cam kết lịch trống. CTA detail vẫn tiếp tục sang yêu cầu báo giá của backend.

Admin xe đã lưu có form thêm/sửa/sắp xếp ảnh. Pending guard chặn gửi lặp;400 giữ input;409 chặn lưu tới khi người dùng tải lại revision mới; late callback xe cũ không báo thành công ở xe mới. Không upload/delete. Staff/USER không được cấp quyền này. Giao diện nghiệp vụ Staff/Admin giữ layout hiện hành.

17 JPEG thật, unique SHA256, khoảng4,3MB (4.311.268bytes);6Vios/6Xpander/5Accent. Trang nguồn Wikimedia và metadata tác giả/license được lưu theo từng file ở registry và evidence. License gồm CC BY-SA4.0, CC BY2.0, CC0; link CC0 được chuẩn hóa HTTPS, giữ URL nguồn trong registry. Thumbnail Wikimedia1200px, không chỉnh sửa thêm. Nhãn “Ảnh minh họa mẫu xe”: thế hệ/phiên bản thị trường có thể khác chiếc xe thuê, không dùng ảnh để khẳng định biển số/tiện nghi.

Người dùng duyệt gắn ảnh vào đúngv1/v2/v3 trong MySQL gốc. Import kiểm exactidentity/volume, mapping/model/bytes, lưu trạng thái trước;transaction khóa xe và từ chối media không rỗng nếu khác plan. SQL readback khớp17rows;25bảng ngoài media giữ checksum; chạy lại NOOP. Không reset/reseed hoặc chạy test ghi trên DB gốc.

## Bằng chứng source cuối

Artifact chính: `.runtime/coordination-c10b-ui-codexa-20261013/`.

| Hạng mục | Kết quả | Artifact |
|---|---|---|
| Frontend tests |77/77,0skip |evidence/tests-commit-final.log |
| Lint |exit0, không hạ rule |evidence/lint-commit-final.log |
| Demo/API build |exit0 cả hai |evidence/build-demo-final.log;build-api-final.log |
| Import guards |3/3 |evidence/import-tests-final.log |
| Runner guards |38/38 |evidence/guards-commit-final/matrix-results.json |
| Browser + real MySQL/JAR |55assertions PASS |evidence/browser-commit-final/browser-results.json |
| Original DB import/readback/idempotency |INSERT rồi NOOP, checksum giữ |evidence/catalog-apply;catalog-idempotency |
| Hash freeze/owned cleanup |PASS |evidence/browser-commit-final/source-before.json;source-after.json;cleanup.json |

Browser proof đủ4trang ×1280/1440/1920, ảnh tải được/naturalWidth, toàn bộ17asset bytes khớp registry, gallery URL/credit, actual image404 fallback/recovery, Admin form POST/PUT/order, real400/409 và held-response chống double-submit, SQL bytes credit, RBAC401/403, không JS pageerror. Booking card populated/Staff route được test bằng actual DOM; browser own-bookings dùng trạng thái empty thật, không coi mock là MySQL proof của booking lifecycle.

Giữ PASS backend21actualMySQL,115executed verify (+12optionalSKIP tách riêng), guards18 và JAR provenance tại lượt c10b-backend-codexa-complete-20261013-101802 vì backend không đổi. Build vẫn có cảnh báo bundle>500kB; không nới warning limit. Không có mobile gate. Đây không phải toàn hệ thống hoặc AI/Map PASS.

## Vận hành

Khởi động frontend API như README; hard refresh sau khi khởi động lại. Source/asset trong Git; dữ liệu ảnh trong MySQL không được vận chuyển bởi `git clone`. DB mới có thể dùng form Admin với URL/credit trong registry, không tự trỏ importer local sang DB khác.

Runner dừng backend/frontend và fixture do lượt sở hữu, giữ volume/evidence và MySQL gốc. Các fixture failed/superseded cũng giữ audit; dọn theo kế hoạch có identity/archive phù hợp, không prune.

## Chỉnh chữ và chốt C10 — 13/10/2026

Theo yêu cầu người dùng, tiêu đề/caption chuyển sang Segoe UI/system sans weight600, hero48–68px/line-height1.14, bỏitalic và giảmnegative tracking. Đây là superseding typography của bảnGeorgia ban đầu, không đổi màu/ảnh/API. Lượt .runtime/coordination-c10-typography-20261013/ đạt77tests/lint/demo+APIbuild và70actualbrowser assertions (computedfont/uprightaccent,4pages×3desktop sizes, nooverflow),376source/buildinputsfreeze0drift; ảnhchụp được xem trực tiếp. Wrapper/helpers/guards giữ source đã PASS38; backend/DB/assets không đổi. Ownedservices/fixture stopped, giữMySQLgốc. C10A tiệnnghi + C10B images/gallery/Admin/17licensedphotos/UrbanUI DONE theo phạmvi đãchốt; không cònfinding mandatory trongC10.
