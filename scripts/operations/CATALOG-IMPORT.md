# Nhập bổ sung danh mục qua API Admin

`catalog_import.py` mặc định chỉ in bản xem trước offline, không kết nối API và không ghi database. Dùng Python 3.12, không cần package mới. Giữ manifest có biển số/địa chỉ và journal trong `.runtime/`, không commit dữ liệu vận hành.

Manifest gồm `approved` (boolean), `branches` (mảng `{name, address}`) và `vehicles` (mảng `{name, plate, brand, category, branch, seats, transmission, dailyPrice}`). `branch` tham chiếu tên chi nhánh trong manifest. Chỉ hỗ trợ ô tô con 2–9 chỗ, `AUTO`/`MANUAL`; giá nguyên đồng dương. Biển số phải là xe riêng biệt, không dùng tên model thay danh tính xe. Manifest đề xuất có thể để null những mục chưa chốt nhưng không thể apply.

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
