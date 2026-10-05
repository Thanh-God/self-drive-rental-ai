# Giai đoạn 4 — Bàn giao UI/UX web và routing

Ngày: 27/09/2026. Trạng thái: hoàn thành triển khai và kiểm tra phạm vi **UI demo desktop**. Không đồng nghĩa hoàn thành hệ thống thuê xe thật hoặc đủ mọi điều kiện bảo vệ của nhà trường.

## Phạm vi bàn giao

- 34 route chức năng và 2 trang hệ thống (không tính redirect, popup hoặc các wildcard 404 trùng nhau). Một số route dùng chung component theo vai trò.
- Guest: trang chủ, tìm/lọc xe, chi tiết/gallery, gợi ý xe và lập hành trình mô phỏng, đăng nhập/đăng ký.
- User: tạo đơn, quản lý đơn, hợp đồng/hóa đơn mẫu, đánh giá, hồ sơ, hành trình đã lưu/chi tiết.
- Staff: hàng đợi, xác nhận/từ chối đơn, giao/nhận xe, hoàn tất, tình trạng đội xe và hồ sơ đơn.
- Admin: dashboard, tài khoản, xe, danh mục/chi nhánh, địa điểm, đánh giá, đơn và hồ sơ. Admin thêm xe; không kế thừa tác vụ giao nhận của Staff.
- Ở lần bàn giao 27/09, demo thay form xác thực bằng chọn vai trò; API có form xác thực và màn chờ tích hợp. Phạm vi API mới ở mục cập nhật 29/09 bên dưới; không dùng kết quả QA cũ để nghiệm thu bản mới.
- Thanh DEMO UI, dữ liệu phiên, khôi phục mẫu, loading/empty/error, 404, sai quyền và không tìm thấy tài nguyên.

## Sửa lỗi trong đợt chốt

- Import `Field` bị thiếu làm trang chủ trắng; bố cục form tìm kiếm được chia hàng để nhãn và ô lọc không bị ép hẹp.
- Kiểm tra thời gian tìm xe thiếu, đảo ngược hoặc ở quá khứ; điều hướng bằng React Router.
- Số xe nổi bật lấy từ dữ liệu thực tế của demo; bỏ lời hứa cố định duyệt đơn trong 2 giờ.
- Gallery hiển thị ghi công đúng ảnh ngoại thất/nội thất (bao gồm CC BY 2.0 của ảnh nội thất Accent), thông báo ảnh minh họa và xử lý thu nhỏ/cắt khung.
- Tách component chi tiết xe để các React hook luôn chạy đúng thứ tự khi xe không tồn tại; đặt lại trạng thái gallery khi đổi xe. Ảnh lỗi không làm mất các ảnh khác khi chuyển gallery.
- Nhãn tìm kiếm không gán aria-labelledby vào phần tử bao ngoài input.

## Kiểm tra bàn giao

Môi trường: Windows, Chromium qua Playwright có sẵn trên máy; không có Browser runtime chuẩn của skill trong phiên, dùng Playwright thay thế. Dev demo: 127.0.0.1:5173. API isolation: 127.0.0.1:5174. Không cài dependency mới cho QA.

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run build` / `npm test` | Build đạt; 6/6 test mô phỏng đạt |
| 36 route × 2 desktop 1366/1440px | 72 lượt đạt: có nội dung, không overlay lỗi, không tràn ngang |
| Trang chủ → tìm Xpander/MPV | Đúng query và kết quả; chặn ngày trả bằng ngày nhận |
| Guest → đăng nhập demo → tạo đơn → Staff xác nhận → hợp đồng → giao → nhận → hoàn tất → User đánh giá → Admin ẩn | Đạt; không lỗi console và không gọi API nghiệp vụ thật |
| Gallery 4 xe × 2 ảnh | 8 ảnh tải được, chọn nội thất hoạt động và cập nhật ghi công |
| Admin thêm xe → Guest tìm xe vừa thêm | Đạt trong cùng phiên demo |
| Modal | Tab giữ focus, Escape đóng và trả focus về nút mở |
| Sai quyền, tài nguyên không có, 404 | Đạt |
| Loading/empty/error | Chuyển trạng thái và thử lại đạt |
| AI demo | Lỗi giải thích giữ gợi ý; thiếu tuyến chặn lưu; thành công lưu/mở hành trình |
| API mode | Không thanh/demo catalog; route User chuyển về form đăng nhập |

Build và test mô phỏng chạy bằng `npm run build`, `npm test` trong frontend. Kịch bản trình duyệt và ảnh QA đặt ngoài repository trong thư mục tạm của máy kiểm thử; bảng trên ghi kết quả lượt bàn giao, không phải bộ CI. Có thể tái kiểm tra thủ công theo luồng trong frontend/README.md. Kiểm tra này không chứng minh mọi tổ hợp dữ liệu, trình duyệt hay quy tắc backend đều đúng.

## Hiện trạng sau tích hợp (Audit 29/09/2026)

- Backend có core API và Flyway V1, đang thực hiện; 6/6 test trên H2 pass không chứng minh core hoàn tất/MySQL concurrency đúng. Xem [audit hệ thống](../architecture/system-architecture.md#7-audit-hiện-trạng-ngày-29092026).
- `src/pages/api` và AppRoutes đã có màn hình xe, báo giá/đơn đa chi nhánh, hợp đồng/hóa đơn, hồ sơ/GPLX, giao nhận, sự cố, tài khoản, xe/đội xe, chi nhánh/tuyến, đánh giá. Đây là kết nối source, chưa phải kết quả E2E trình duyệt trong lượt audit.
- Form đặt xe đã chọn điểm nhận/trả; API lưu/kiểm tra GPLX, Staff có checkbox nhưng chưa hiển thị hồ sơ GPLX trả về để đối chiếu. Có form sự cố/căn cứ/đánh giá/phản hồi; còn lỗi biên thời gian/quyền khóa xe/lịch sử căn cứ ở backend.
- Giữ hướng tái sử dụng chọn lọc UI Redesign theo decisions.md; không sao chép cả folder/store. Không mặc định mọi trang API hiện có đã được chuyển từ bản Redesign.
- AI/Map chưa triển khai, chỉ xây sau core; công nghệ AI chưa chốt. Dashboard, locations và hành trình API đang chờ kết nối. `/admin/catalog` API hiện chỉ chi nhánh/tuyến, thiếu CRUD danh mục xe.
- 29/09: frontend build và 6/6 demo tests pass; ESLint 0 errors/14 warnings. Chưa chạy lại 72 lượt browser QA cho code API mới. Không thay bảng QA 27/09 bằng kết luận chưa kiểm chứng.

## Cách nghiệm thu lại nhanh

1. Chạy demo theo frontend/README.md và bấm Khôi phục mẫu.
2. Kiểm tra trang chủ, tìm xe không có kết quả, xóa lọc, mở xe và đổi ảnh.
3. Dùng xe Accent ở khoảng thuê sau hiện tại 7–8 ngày để thử luồng đơn đầy đủ, tránh lịch mẫu đang thuê.
4. Đổi Staff để xác nhận/giao/nhận/hoàn tất; đổi User đánh giá; đổi Admin kiểm duyệt và thêm xe.
5. Thử sai vai trò, URL không tồn tại, loading/empty/error và AI thiếu tuyến.
6. Mở console kiểm tra lỗi, kiểm tra desktop 1366/1440px và chạy build/test trước commit.

## Cập nhật tích hợp frontend API ngày 04/10/2026

Phần dưới là cập nhật sau audit; không thay thế hoặc nâng cấp kết quả QA demo lịch sử phía trên.

- N02: quote được gắn với snapshot xe, chi nhánh nhận/trả và thời gian; thay đổi input hoặc response không còn hiện hành thì không được xuất bản quote.
- N03: chi tiết Staff lấy danh sách phân công từ `GET /api/v1/me/branches`; xác nhận/giao xe dùng chi nhánh nhận, nhận trả/hoàn tất dùng chi nhánh trả. Khi chưa tải được phân công, ẩn action và báo lỗi. GPLX của khách hiển thị độc lập với danh sách action. UI không tự suy diễn tương thích hạng GPLX; backend quote và giao xe vẫn là nguồn quyết định.
- N04: `useApiData` gắn data/error với request key và chỉ nhận kết quả request hiện hành; đổi route/reload không hiển thị kết quả cũ.
- L11: bảo vệ response 401 cũ không xóa token phiên mới; hydrate/login/logout có generation để chặn session cũ khôi phục state đã hết hiệu lực.
- Audit sự cố dùng `GET /api/v1/incidents/{id}/events`; hiển thị thời điểm xảy ra và báo cáo riêng, cùng các trường căn cứ/trạng thái/số tiền nếu API trả. Form giới hạn thời điểm xảy ra theo biên bản giao/trả thực tế (hoặc hiện tại nếu chưa trả), cho phép khai báo muộn mà không dời thời điểm sự cố. Backend vẫn kiểm tra lại; form không kết luận trách nhiệm hoặc tự trừ cọc.
- Regression frontend: `npm run lint` (0 warning), `npm test` (20 pass, 0 fail/skip), và build demo/API đều pass. Unit tests không thay thế nghiệm thu API.
- Cập nhật nghiệm thu runtime ngày 04/10: trên MySQL 8.4.11 cô lập, Chromium API mode chạy PASS luồng User đặt xe → Staff đúng/sai chi nhánh xác nhận/giao/nhận/hoàn tất → User đánh giá → Admin từ chối giao nhận và kiểm duyệt review; hai thao tác sai chi nhánh và thao tác Admin trả HTTP 403. Booking `6510429c-aaf8-4623-a1d5-9a2c52cfab20`; ảnh/JSON bằng chứng được giữ ngoài repository trong `.runtime/phase5-rerun-20261004-1823/browser-artifacts/`. Đây là một luồng acceptance, không phải kiểm thử concurrency hay chứng nhận toàn bộ schema/dữ liệu production. QA demo 27/09 phía trên vẫn là lịch sử riêng.

## Cập nhật nghiệm thu tiếp theo ngày 04/10/2026

- Đóng gói lại backend từ source bàn giao vì JAR cũ có timestamp trước source/classes: `mvnw.cmd -DskipTests package` thành công. Khởi động trên schema KLTN hiện có; Flyway validate 2 migration, schema version 2 up-to-date; Hibernate `ddl-auto: validate` khởi tạo thành công. Seed tắt khi chạy lại, không xóa/khôi phục dữ liệu.
- Browser API/MySQL thật chạy lại PASS trên booking mới `479804a3-32da-4eb0-acf9-0870bac4671f` (HN→ĐN): User quote/tạo đơn và lưu GPLX; Staff sai chi nhánh bị từ chối; Staff chi nhánh nhận xác nhận/giao; Staff chi nhánh trả nhận/hoàn tất; User đánh giá; Admin bị từ chối giao nhận và kiểm duyệt review. Hai ca Staff sai chi nhánh và ca Admin trả HTTP 403 đúng kỳ vọng. Bằng chứng JSON/screenshot riêng ở `.runtime/phase5-rerun-20261004-1823/browser-artifacts/copilot-20261004-2232/`.
- Sửa hiển thị lịch sử incident: kết quả events được gắn với incident ID tương ứng; khi chọn incident khác không còn hiển thị lịch sử cũ trong lúc chờ, có loading/error riêng. Regression test bảo vệ trường hợp chọn incident khác.
- Browser GET danh sách incident trên booking này trả HTTP 200 `[]`, UI hiển thị trạng thái rỗng. Không có incident records trong 6 booking test sẵn có; không tạo incident giả để kiểm thử event payload. Do đó render của từng event thực tế/các trường trách nhiệm vẫn **chưa nghiệm thu runtime**; đối chiếu tĩnh `GET /api/v1/incidents/{id}/events` với response JDBC snake_case và UI đã xác nhận tên trường, nhưng cần dữ liệu sự cố hợp lệ để E2E sâu hơn.
- Regression mới: lint 0 warning; `npm test` 22/22 pass; build demo/API đều pass. Không thực hiện concurrency stress test hoặc kiểm tra dữ liệu production.
