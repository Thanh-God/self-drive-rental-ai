# Giai đoạn 4 — Bàn giao UI/UX web và routing

Ngày: 27/09/2026. Trạng thái: hoàn thành triển khai và kiểm tra phạm vi **UI demo desktop**. Không đồng nghĩa hoàn thành hệ thống thuê xe thật hoặc đủ mọi điều kiện bảo vệ của nhà trường.

## Phạm vi bàn giao

- 34 route chức năng và 2 trang hệ thống (không tính redirect, popup hoặc các wildcard 404 trùng nhau). Một số route dùng chung component theo vai trò.
- Guest: trang chủ, tìm/lọc xe, chi tiết/gallery, gợi ý xe và lập hành trình mô phỏng, đăng nhập/đăng ký.
- User: tạo đơn, quản lý đơn, hợp đồng/hóa đơn mẫu, đánh giá, hồ sơ, hành trình đã lưu/chi tiết.
- Staff: hàng đợi, xác nhận/từ chối đơn, giao/nhận xe, hoàn tất, tình trạng đội xe và hồ sơ đơn.
- Admin: dashboard, tài khoản, xe, danh mục/chi nhánh, địa điểm, đánh giá, đơn và hồ sơ. Admin thêm xe; không kế thừa tác vụ giao nhận của Staff.
- Chế độ demo thay form xác thực bằng chọn vai trò; chế độ API có form xác thực và màn chờ tích hợp, không tự dùng dữ liệu giả khi API lỗi.
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

## Giới hạn chuyển sang giai đoạn tiếp theo

- Backend Spring Boot, MySQL/Flyway, API DTO, xác thực thật và phân quyền server chưa triển khai. Dữ liệu demo không phải database thật.
- Cần kiểm thử transaction chống đặt trùng, giá/hồ sơ bất biến, cập nhật đồng thời, bảo mật và API integration khi có backend.
- Gemini/Map thật, tối ưu lịch trình, quota và quyền AI của Guest cần triển khai/chốt riêng. Không coi số liệu tuyến demo là tuyến đã kiểm chứng.
- Ảnh đang dùng là minh họa công khai, không phải ảnh của một xe cụ thể; upload ảnh và xác minh hình ảnh xe thực tế thuộc bước triển khai sau. Nguồn ảnh được lưu ở manifest, UI ghi công theo ảnh; nguồn ngoại thất Xpander có trong danh mục Wikimedia nhưng trang chi tiết không truy cập được bằng công cụ web trong lượt rà soát này. Không tuyên bố đã kiểm toán bản quyền độc lập toàn bộ bộ ảnh.
- Những chính sách còn mở như cọc/phụ phí, giao sớm/trả muộn, gia hạn/no-show và phát hành lại hồ sơ theo sổ quyết định; không tự đặt giá trị 0 hoặc bổ sung nghiệp vụ ngoài phạm vi.
- Không phát triển mobile riêng trong giai đoạn này. Báo cáo, slide, triển khai và nghiệm thu học thuật không nằm trong mốc hoàn tất UI.

## Cách nghiệm thu lại nhanh

1. Chạy demo theo frontend/README.md và bấm Khôi phục mẫu.
2. Kiểm tra trang chủ, tìm xe không có kết quả, xóa lọc, mở xe và đổi ảnh.
3. Dùng xe Accent ở khoảng thuê sau hiện tại 7–8 ngày để thử luồng đơn đầy đủ, tránh lịch mẫu đang thuê.
4. Đổi Staff để xác nhận/giao/nhận/hoàn tất; đổi User đánh giá; đổi Admin kiểm duyệt và thêm xe.
5. Thử sai vai trò, URL không tồn tại, loading/empty/error và AI thiếu tuyến.
6. Mở console kiểm tra lỗi, kiểm tra desktop 1366/1440px và chạy build/test trước commit.
