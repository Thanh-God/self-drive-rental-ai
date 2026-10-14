# Nhập bổ sung danh mục qua API Admin

`catalog_import.py` mặc định chỉ in bản xem trước offline, không kết nối API và không ghi database. Dùng Python 3.12, không cần package mới. Giữ manifest có biển số/địa chỉ và journal trong `.runtime/`, không commit dữ liệu vận hành.

Manifest gồm `approved` (boolean), `branches` (mảng `{name, address}`) và `vehicles` (mảng `{name, plate, brand, category, branch, seats, transmission, dailyPrice}`). `branch` tham chiếu tên chi nhánh trong manifest. Chỉ hỗ trợ ô tô con 2–9 chỗ, `AUTO`/`MANUAL`; giá nguyên đồng dương. Biển số phải là xe riêng biệt, không dùng tên model thay danh tính xe. Manifest đề xuất có thể để null những mục chưa chốt nhưng không thể apply.

Xe có thể thêm `description` tối đa2000ký tự. Với cấu hình giả lập cho đồ án, mã nội bộ có thể dùng thay biển số nếu được người dùng duyệt và tài liệu xác định rõ đây không phải xe/địa điểm kinh doanh thực. Không tạo biển số giống thật rồi tuyên bố đó là xe vận hành của doanh nghiệp.

```powershell
python -X utf8 scripts/operations/catalog_import.py .runtime/catalog-approved.json
python scripts/operations/test_catalog_import.py
```

Trước apply: đối chiếu inventory API hiện tại để đạt tổng số xe mong muốn thay vì cộng trùng model đã có; kiểm kê migration/history/schema và backup database đích theo quy trình vận hành. Duyệt chính xác manifest, target và hash byte của file. Token Admin lấy từ phiên đăng nhập được phép, đặt trong biến môi trường `KDRIVE_ADMIN_TOKEN`, không truyền trên command line hoặc lưu trong manifest/journal.

```powershell
python scripts/operations/catalog_import.py .runtime/catalog-approved.json --apply --base-url http://127.0.0.1:8080/api/v1 --approved-sha256 <SHA256_DA_DUYET> --journal .runtime/catalog-import-new.jsonl
```

Chạy thử trên fixture MySQL riêng trước khi dùng với dữ liệu vận hành. Công cụ xác nhận role Admin, đọc inventory và từ chối xung đột chi nhánh/biển số trước POST đầu tiên. Chỉ tạo mới hãng, loại, chi nhánh và xe còn thiếu; không PUT/DELETE, đổi vị trí xe cũ, seed hoặc sửa migration. Xe đã khớp được giữ nguyên cả trạng thái/vị trí hiện tại. Tên trùng không rõ danh tính phải xử lý thủ công trước. Không chạy đồng thời với tác vụ cập nhật catalog khác.

API tạo nhiều đối tượng bằng nhiều transaction: không có rollback toàn batch. Khi lỗi, công cụ dừng ngay, giữ ID đã tạo trong journal; không tự xóa hoặc retry. Nếu mất kết nối sau POST, đối chiếu API trước chạy lại vì server có thể đã commit. Journal mở bằng chế độ tạo file mới, không ghi đè.

Sau nhập: đọc lại `/vehicles`, `/vehicles/catalog`, `/branches`, đối chiếu từng ID/biển số/giá/chi nhánh và số lượng. Ảnh phải nhập riêng qua Admin kèm giấy phép/ghi công; không gán ảnh model khác. Tuyến/phí và phân công Staff phải được duyệt và cấu hình riêng: thêm chi nhánh chưa làm nó sẵn sàng vận hành. Công cụ này không tạo tuyến, tài khoản hoặc phân công. Kiểm homepage sáu xe, danh sách đủ dữ liệu, lọc hãng, ảnh, quote và quyền Staff trên fixture trước nghiệm thu.

## Kiểm tra giao diện với dữ liệu HTTP kiểm soát

Đặt `KDRIVE_PLAYWRIGHT` trỏ module Playwright đã cài cùng Chromium tương ứng; chạy `node scripts/operations/verify-catalog-ui.cjs <thu-muc-evidence-moi>`. Runner tự mở Vite cổng5315 ở127.0.0.1 với strictPort, tự đóng server/browser trong finally; không dừng dịch vụ khác. Nó cấp20xe qua HTTP interception để kiểm 6thẻ homepage, link Xem thêm, trạng thái, logo và desktop1280/1440. Đây là kiểm tra render/interaction, không chứng minh backend hoặc dữ liệu database đã được bổ sung.

## Điều chỉnh dữ liệu cũ, ảnh và vận hành qua API

`configure_catalog.py <plan>` mặc định preview offline. Apply có cùng các cờ `--apply`, `--approved-sha256`, `--base-url`, `--journal` và token env như công cụ tạo mới. Plan có `approved`, các mảng tùy chọn:

- `vehicles`/`branches`: `{expected, changes}`; expected chứa ID/version và các thuộc tính cần bảo toàn. Chỉ sửa name/plate/description của xe và name/address của chi nhánh; không đổi giá, trạng thái hoặc vị trí xe bằng công cụ này.
- `images`: `{plate, model, url, attribution, sha256}`; chỉ asset local `/media/vehicles/` khớp hash và đúng tên xe. Thêm ảnh qua revision API, giữ ảnh có sẵn và từ chối credit khác cho cùng URL.
- `routes`: `{pickup, return, fee}` tham chiếu tên chi nhánh sau sửa. Chỉ tạo tuyến còn thiếu; từ chối tuyến hiện có khác cấu hình. Phí0 cũng phải được duyệt, không được suy là policy kinh doanh mặc định.
- `assignments`: `{userId, branch}` chỉ mở rộng phân công của Staff đã có phân công. Không tạo tài khoản/reset mật khẩu.

Các amendment được kiểm trước write; ảnh kiểm hash local, không overwrite. Hai công cụ vẫn gồm nhiều transaction: dừng khi lỗi, giữ journal và đọc lại trước thử tiếp. Trình tự batch: tạo mới → configure → đọc lại. Sau configure đổi tên chi nhánh, không chạy mù manifest create cũ vì nó tham chiếu tên trước đổi; cần kiểm inventory/reconcile. Cấu hình đã khớp được giữ nguyên khi replay configure.

## Rehearsal MySQL thật

`python -X utf8 scripts/operations/rehearse_catalog.py --batch <runtime-batch> --backend-root <runtime-backend-copy> --evidence <runtime-evidence-moi>` yêu cầu batch `catalog-create-proposal.json` và `catalog-configure-proposal.json`. Runner chỉ tạo một fixture riêng port33681, backend8381/frontend5381; không nhận DB_URL đích từ manifest. Xác minh source copy và class bytes trong JAR; giữ volume stopped và đóng đúng process được tạo. Có schema riêng cho ca batch lỗi một phần; không dọn dữ liệu để giả rollback. Cần Docker/MySQL8.4, JDK21 và Playwright/Chromium đã cài theo cấu hình runner. Chạy tuần tự khi các cổng trống.

Runner tạo bản manifest approved chỉ bên trong fixture evidence để kiểm thử, không đổi cờ approved của đề xuất dành cho DB vận hành. Nó gọi actual CLI/API, kiểm repeat/conflict/partial failure, bảo toàn dữ liệu và contract đại diện, giá/quyền Staff cùng browser thật không interception. Source runner cần phù hợp inventory/identity của batch; không dùng cho project/DB khác. Cấu hình cổng/JDK/runtime hiện là môi trường phát triển local, không phải production.

## Áp dụng batch đã được duyệt vào database local

`deploy_catalog_batch.py` chỉ dành cho batch OTO1 cụ thể đã được người dùng duyệt, với hash proposal cố định trong source. Không phải công cụ deploy tổng quát. Chạy guard tests trước:

```powershell
python -X utf8 scripts/operations/test_deploy_catalog_batch.py
python -X utf8 scripts/operations/deploy_catalog_batch.py --batch <runtime-batch-da-duyet> --backend-root <runtime-backend-copy> --evidence <runtime-evidence-moi> --apply-approved-oto1
```

Không có cờ apply thì chỉ preflight. Khi apply, runner kiểm exact identity/volume/schema gốc, toàn bộ catalog/version/history, hash ảnh và source/JAR. Nó tạo backup SQL nén riêng tư, kiểm gzip/hash và restore trên schema riêng trong đúng fixture OTO1 đã nghiệm thu; so checksum cả26bảng trước ghi. Không restore đè hoặc mount volume DB gốc.

Chỉ khi các bước trên đạt mới chạy backend riêng với `SEED_ENABLED=false`, đăng nhập Admin hiện có bằng thông tin local được giữ riêng và gọi CLI create/configure. Không tạo/reset tài khoản. Source yêu cầu DB_URL local33385/kdrive chính xác; không fallback3306. Kiểm protected-table content SHA trước/sau, counts/history và browser thật GET-only. Giữ backup/journal/evidence local; dừng owned backend/frontend/probe, giữ MySQL gốc chạy. Lỗi sau khi bắt đầu ghi phải kiểm journal/readback để xử lý phần đã commit, không tự rollback hoặc chạy lại cùng batch mù.
