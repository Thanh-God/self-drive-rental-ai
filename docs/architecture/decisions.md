# Quyết định kiến trúc và vấn đề còn mở

Cập nhật: 25/09/2026. Người dùng đã duyệt áp dụng kế hoạch Giai đoạn 2 và yêu cầu dùng VS Code cho cả Java/React. Duyệt kiến trúc không đồng nghĩa tự động chốt các chính sách đã được đánh dấu còn mở.

## Đã chốt

| ID | Quyết định | Lý do và tác động |
|---|---|---|
| AD-01 | React/Vite, Spring Boot, MySQL, JPA/Hibernate, Security/JWT, Gemini, Map API | Giữ stack Giai đoạn 1; phiên bản tương thích chốt khi khởi tạo |
| AD-02 | Modular monolith, một backend/một database | Vừa sức ba tháng, transaction đơn giản; cần giữ ranh giới module |
| AD-03 | Đúng bốn actor; Guest không là role tài khoản | Role USER/STAFF/ADMIN; Gemini/Map là hệ thống ngoài |
| AD-04 | Backend kiểm soát giá, availability, ID, score và trạng thái | AI giải thích/lập phương án trên dữ liệu cấp sẵn; cần validate output |
| AD-05 | Backend chia theo nghiệp vụ, bỏ module giữ chỗ staff/admin | Tránh trùng logic theo role; giữ đầy đủ chức năng và pages frontend |
| AD-06 | Tách branch và location | Điểm giao nhận khác điểm tham quan; demo một chi nhánh, nhận/trả cùng chi nhánh; chưa mở rộng điều chuyển xe |
| AD-07 | Flyway chỉ ở backend/src/main/resources/db/migration | Schema có một lịch sử; database/docs chỉ hướng dẫn và thiết kế |
| AD-08 | VS Code viết/chạy/debug cả backend và frontend | Giảm số công cụ phải học; build Java không phụ thuộc NetBeans |
| AD-09 | Database tối đa 30 bảng | Mục tiêu sơ bộ 18–24 bảng nghiệp vụ, phải đếm lại cả bảng kỹ thuật ở ERD; chưa coi ước lượng là thiết kế |
| AD-10 | MVP không thanh toán online, không microservices | Tập trung luồng thuê xe và hai chức năng AI |

## Còn mở — phải chốt trước bước phụ thuộc

| ID | Nội dung | Phương án đang xem xét, chưa áp dụng | Chốt trước |
|---|---|---|---|
| OP-01 | Guest dùng AI | Giai đoạn 1 đề xuất preview; Giai đoạn 2 đề xuất chỉ User để giảm quota. Chưa chọn giữa hai phương án | API/UX AI |
| OP-02 | Giấy phép lái xe | Staff kiểm tra thủ công, ghi kết quả, không lưu ảnh | ERD và giao nhận |
| OP-03 | Ngày thuê/giá/cọc | Block 24 giờ làm tròn lên; mức cọc, cách làm tròn tiền và múi giờ cần xác định | Schema snapshot và booking |
| OP-04 | PENDING/state machine | Có giữ lịch là hướng đề xuất; thời hạn giữ, hết hạn, sát giờ nhận, trả muộn và thời gian đệm chưa chốt | ERD và transaction booking |
| OP-05 | Hợp đồng/hóa đơn | Hợp đồng khi xác nhận, hóa đơn khi hoàn tất là đề xuất; dữ liệu snapshot/phát hành lại cần rõ | Schema và luồng phát hành |
| OP-06 | Hủy và Admin can thiệp | Mốc 24 giờ là đề xuất; quy trình sát giờ, lý do và thao tác Admin cụ thể cần chốt | Ma trận quyền chi tiết/state machine |
| OP-07 | Map provider | Chọn theo tài khoản, coverage, quota và điều kiện sử dụng; không mặc định OpenStreetMap là một dịch vụ API đầy đủ | Adapter Map |
| OP-08 | JWT/khóa tài khoản | Thời hạn, refresh/revoke, lưu token phía client, hiệu lực khóa tài khoản | Auth |
| OP-09 | Fallback itinerary | Dừng và thử lại hoặc cho phép bản thiếu tuyến có nhãn; phạm vi chỉnh sửa thủ công chưa chốt | UI/API itinerary |
| OP-10 | Môi trường/phiên bản | JDK/Spring Boot tương thích, MySQL Server, Maven Wrapper, thư viện UI và seed demo | Khởi tạo ứng dụng |

Không tự mở rộng sang đa chi nhánh vận hành, phân quyền theo chi nhánh hoặc thanh toán để giải quyết các mục còn mở. Quyền Staff theo phạm vi dữ liệu phải được ghi rõ ở thiết kế API; chưa có cơ chế phân công Staff theo chi nhánh.

## Trade-off và rủi ro

| Rủi ro | Hướng xử lý | Giá phải trả/kiểm chứng |
|---|---|---|
| Đặt trùng khi đồng thời | Transaction và khóa xe, truy vấn overlap hiện hành | Tăng thời gian chờ cùng xe; kiểm thử đồng thời trên MySQL |
| Phụ thuộc vòng giữa module | Service điều phối, DTO, không truy cập chéo repository | Phải rà dependency khi bổ sung luồng phát hành hồ sơ |
| AI bịa facts/lịch không khả thi | Schema + validation nghiệp vụ, output chỉ tham chiếu dữ liệu được cấp | Không bảo đảm mọi lịch hấp dẫn; cần bộ tình huống đánh giá |
| Gemini/Map chậm hoặc hết quota | Timeout, giới hạn input/calls, fallback minh bạch | Trải nghiệm giảm khi dịch vụ ngoài lỗi |
| Lệch schema | Một nguồn Flyway, Hibernate validate | Không sửa migration đã chạy; thay đổi cần migration mới |
| Quá nhiều công cụ | VS Code là trung tâm; browser, Git, MySQL phục vụ vai trò rõ | Không tận dụng mọi tính năng của IDE khác, đổi lại dễ học và demo |
| Vượt thời gian/số bảng | Hoàn thành MVP trước, ERD có ngân sách bảng | Dashboard, thông báo, audit nâng cao để sau |

## Cách giải thích với hội đồng

- Role trả lời “ai được làm”; module trả lời “nghiệp vụ nào chịu trách nhiệm”. Vì vậy không cần module dữ liệu Admin riêng.
- Catalog xe và đơn thuê là dữ liệu chuẩn; AI chỉ hỗ trợ lựa chọn và lập lịch nên lỗi AI không làm sai giao dịch.
- Một backend giúp triển khai và kiểm thử phù hợp nguồn lực cá nhân, vẫn có phân tách trách nhiệm để bảo trì.
- VS Code là nơi phát triển; React và Spring Boot giao tiếp qua REST, không có cơ chế liên kết hai IDE.
- Kiến trúc được duyệt là cơ sở cho ERD/state machine/API ở giai đoạn kế tiếp, không thay thế các thiết kế chi tiết đó.
