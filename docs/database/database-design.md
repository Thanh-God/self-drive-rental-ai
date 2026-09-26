# Giai đoạn 3 — Thiết kế database cơ sở

Ngày 26/09/2026, người dùng duyệt phương án 20 bảng nghiệp vụ và các phương án chính sách đã đề xuất. Tài liệu này ghi nhận thiết kế cơ sở; chưa phải từ điển dữ liệu đầy đủ hoặc migration đã kiểm thử. Các thông số chưa từng có đề xuất cụ thể không được coi là đã chốt.

## Danh sách bảng và chủ sở hữu

| Module | Bảng | Vai trò |
|---|---|---|
| user | users | Tài khoản mọi role, hồ sơ, trạng thái và phiên bản token |
| branch | branches | Chi nhánh giao nhận |
| vehicle | vehicle_brands | Hãng xe |
| vehicle | vehicle_categories | Loại xe |
| vehicle | vehicles | Xe, giá hiện hành, trạng thái khai thác, chi nhánh |
| vehicle | amenities | Danh mục tiện nghi |
| vehicle | vehicle_amenities | Liên kết xe và tiện nghi |
| vehicle | vehicle_images | Ảnh xe và thứ tự hiển thị |
| booking | bookings | Đơn thuê, khoảng thuê, hạn giữ lịch, snapshot giá |
| booking | booking_status_history | Trạng thái trước/sau, người thao tác, thời điểm, lý do |
| operation | vehicle_handover_records | Biên bản giao/nhận phân biệt bằng loại |
| contract | contracts | Hợp đồng và snapshot khi phát hành |
| invoice | invoices | Hóa đơn, tổng tiền và thời điểm phát hành |
| invoice | invoice_items | Từng khoản tiền trên hóa đơn |
| review | reviews | Đánh giá theo đơn, trạng thái kiểm duyệt |
| location | location_categories | Phân loại địa điểm tham quan |
| location | locations | Địa điểm, tọa độ và tham chiếu nguồn |
| ai/itinerary | itineraries | Chủ sở hữu, thông tin chuyến đi và tiêu chí |
| ai/itinerary | itinerary_days | Ngày trong hành trình |
| ai/itinerary | itinerary_items | Điểm tham quan, thứ tự, khung giờ, ước tính tuyến |

Tổng 20 bảng nghiệp vụ + flyway_schema_history = 21 bảng. Chưa thêm driver_license_verifications, auth_sessions hoặc audit_logs. Role USER/STAFF/ADMIN lưu trên tài khoản; không có bảng Guest hoặc bảng tài khoản Staff/Admin riêng. Recommendation chưa lưu lịch sử.

## Quan hệ cơ sở

- User có nhiều booking; mỗi booking thuộc một người thuê, một xe và một chi nhánh nhận/trả. Chi nhánh có nhiều xe; hãng/loại có nhiều xe.
- Xe có nhiều ảnh và nhiều tiện nghi qua bảng liên kết.
- Booking có nhiều bản ghi lịch sử; tối đa một biên bản giao và một biên bản nhận, một hợp đồng, một hóa đơn và một đánh giá trong mô hình cơ sở. Nếu chính sách phát hành lại đòi nhiều phiên bản thì phải rà lại cardinality trước DDL.
- Invoice có nhiều invoice_items. Review lấy quyền sở hữu và xe từ booking, không để client chọn độc lập các tham chiếu mâu thuẫn.
- User có nhiều itinerary; itinerary có nhiều ngày; ngày có nhiều mục; mỗi mục tham quan tham chiếu location. Hành trình không bắt buộc gắn booking.
- Khóa ngoại xuyên module bảo đảm tham chiếu; Java vẫn chỉ gọi service/DTO xuyên module, không truy cập chéo repository.

## Chính sách đã duyệt

| Nội dung | Phương án được chấp thuận |
|---|---|
| Giấy phép | Staff kiểm tra thủ công trước giao, ghi kết quả/người kiểm tra/thời điểm; không lưu ảnh |
| Thời lượng và tiền | Số ngày thuê = làm tròn lên thời lượng theo block 24 giờ; thời lượng phải dương; VND nguyên đồng |
| Múi giờ | Chuẩn hóa thời điểm về UTC để lưu; hiển thị giờ Việt Nam Asia/Ho_Chi_Minh; ngày hành trình được hiểu theo múi giờ chuyến đi |
| Giữ lịch | PENDING chiếm lịch; expires_at = thời điểm sớm hơn giữa created_at + 2 giờ và start_at |
| Luồng chính | PENDING → CONFIRMED → IN_PROGRESS → RETURNED → COMPLETED; có nhánh từ chối/hủy/hết hạn |
| Hợp đồng/hóa đơn | Hợp đồng khi xác nhận, hóa đơn khi hoàn tất; giữ snapshot khi phát hành |
| Hủy | User tự hủy theo mốc trước giờ nhận ít nhất 24 giờ; sát giờ Staff xử lý kèm lý do |
| Admin | Can thiệp hủy theo quyền và state machine; không mặc định nhận quyền giao/nhận |
| Auth | Access token ngắn hạn, không refresh; server kiểm tra trạng thái tài khoản và phiên bản token; đăng xuất thu hồi mọi phiên bằng đổi phiên bản |
| Itinerary lỗi | Dừng/thử lại khi thiếu dữ liệu kiểm chứng; không lưu bản thiếu tuyến; chưa triển khai trình chỉnh sửa thủ công đầy đủ |

Trả muộn không được coi là đã trả chỉ vì vượt end_at. Quy tắc xử lý đơn kế tiếp, gia hạn và no-show phải được hoàn thiện trước triển khai. RETURNED ghi nhận xe đã về; COMPLETED chỉ xảy ra sau xử lý hoàn tất và hóa đơn. Không tự suy luận quyền hủy đơn đang thuê từ quyền Admin can thiệp.

## Snapshot và lưu lịch sử

- Booking giữ đơn giá, số đơn vị thuê, tiền thuê, cọc, tổng theo chính sách và phiên bản chính sách. Mức/ý nghĩa cọc chưa chốt nên chưa ấn định công thức cộng cọc vào tổng.
- Contract giữ thông tin các bên, xe, chi nhánh, thời gian, điều khoản và chi phí khi phát hành. Invoice giữ từng khoản, số lượng, đơn giá và thành tiền; không cập nhật theo giá catalog mới.
- Itinerary giữ tên/tọa độ điểm và ước tính tuyến kèm nguồn/thời điểm lấy. Thiếu distance/duration không được ghi bằng 0. Dữ liệu quan hệ quan trọng dùng cột/FK; JSON chỉ cho tiêu chí hoặc metadata linh hoạt.
- Catalog/tài khoản được ngừng hoạt động hoặc khóa; không xóa cứng lịch sử giao dịch, không cascade xóa đơn theo xe/tài khoản. Review ẩn/hiện kèm thông tin kiểm duyệt. Chính sách xóa hành trình cá nhân sẽ xác định trước tính năng xóa.

## Ràng buộc, khóa và chỉ mục dự kiến

- PK nội bộ; unique mã đơn/hợp đồng/hóa đơn, email chuẩn hóa, biển số chuẩn hóa; FK và nullability sẽ chi tiết trong từ điển dữ liệu.
- start_at < end_at, tiền không âm, rating 1–5; unique review.booking_id, cặp vehicle/amenity, cặp booking/loại biên bản, ngày/thứ tự mục.
- Version chống ghi đè trên bản ghi cập nhật đồng thời. Service kiểm tra quyền, chủ sở hữu, chuyển trạng thái và tính nhất quán giữa các bảng.
- Transaction đặt xe khóa bản ghi xe trước, đọc trạng thái hiện hành và overlap rồi ghi đơn. Mọi thao tác chiếm/thay đổi lịch theo cùng giao thức; thứ tự xe rồi đơn nhất quán. Không chỉ khóa những đơn tìm được vì xe chưa có đơn vẫn cần khóa.
- Overlap dùng newStart < existingEnd AND newEnd > existingStart, cần kết hợp chính sách đệm và trạng thái đã hoàn thiện. Tại biên hết hạn phải kiểm tra hạn hiện hành trong transaction, không phụ thuộc duy nhất vào tốc độ job hết hạn.
- Chỉ mục ứng viên: booking(vehicle_id, status, start_at) và lọc end_at; booking(user_id, created_at); booking(status, created_at); booking(status, expires_at); itinerary(user_id, updated_at). Chỉ mục catalog sẽ theo bộ lọc thực tế; kiểm chứng execution plan trên MySQL khi triển khai.
- Contract có thể điều phối xác nhận booking rồi phát hành trong cùng transaction; operation điều phối nhận/hoàn tất và invoice. Không tạo vòng booking → contract → booking.

## Ranh giới AI

Backend quyết định ID, giá, availability, score và state transition. Gemini chỉ hiểu/giải thích/lập lịch từ candidates được cấp. Không gửi mật khẩu, token, giấy tờ. Gọi Gemini/Map ngoài transaction; kiểm tra schema, tham chiếu, thời gian, tuyến và quyền trước transaction ngắn để lưu kế hoạch. Không lưu output không đạt validation.

## Chi tiết còn mở và bước tiếp theo

Các lựa chọn trước đó chưa có phương án cụ thể: mức và ý nghĩa cọc (bảo đảm hay trả trước), ghi nhận thu/hoàn cọc, phụ phí và làm tròn theo tỷ lệ; lưu số/hạn GPLX và lịch sử xác minh; khoảng đệm; no-show/gia hạn/trả muộn và đơn kế tiếp; sửa/phát hành lại hồ sơ; TTL token và lưu token phía client. Guest AI, Map provider và môi trường chuẩn vẫn theo OP-01/07/10.

Sau khi bổ sung các chi tiết ảnh hưởng schema: hoàn thiện ERD, từ điển dữ liệu, ma trận chuyển trạng thái/quyền và kế hoạch kiểm thử; trình duyệt thiết kế chi tiết trước migration. Chưa được coi tài liệu này là chứng nhận database đã hoạt động.

Ca kiểm chứng khi có code/MySQL: hai người đặt trùng chỉ một thành công; hai Staff xử lý một đơn; xác nhận tranh chấp với hết hạn; giá catalog đổi không đổi snapshot; lỗi giao nhận/phát hành rollback; xe trả muộn; User không xem hồ sơ người khác; token cũ mất hiệu lực sau đăng xuất/khóa; itinerary lỗi không lưu.
