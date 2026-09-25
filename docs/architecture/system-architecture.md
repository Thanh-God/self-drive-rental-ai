# Giai đoạn 2 — Kiến trúc tổng thể

Trạng thái: kiến trúc được người dùng duyệt ngày 25/09/2026; chưa phải hệ thống đã triển khai. Phạm vi nghiệp vụ theo [Giai đoạn 1](../requirements/system-scope.md); các chính sách chưa chốt theo [sổ quyết định](decisions.md).

## 1. Mục tiêu và hình thức triển khai

Một React SPA gọi một Spring Boot REST API; backend gồm các module nghiệp vụ trong cùng ứng dụng, truy cập một MySQL database bằng JPA/Hibernate. Đây là modular monolith: phân chia trách nhiệm trong mã nguồn nhưng build/triển khai backend như một đơn vị.

Phù hợp đồ án cá nhân khoảng ba tháng: giao dịch đặt xe có thể xử lý trong một database, ít thành phần phải vận hành, dễ theo dõi lỗi. Đổi lại, phải kiểm soát phụ thuộc module và kiểm thử tránh thay đổi một module làm hỏng luồng khác. Không bổ sung microservices, message broker hoặc database riêng cho từng module.

[Sơ đồ component và cách đọc](../diagrams/component-diagram.md).

Trong phát triển, VS Code mở toàn bộ repository; hai tiến trình backend/frontend chạy riêng, giao tiếp qua HTTP. IDE không tham gia kiến trúc runtime. MySQL là dịch vụ riêng; dữ liệu không nằm trong editor. Cổng, origin và cấu hình triển khai sẽ được chốt khi khởi tạo ứng dụng.

## 2. Quy tắc tổ chức

- Controller kiểm tra hình thức request, gọi service và trả DTO; không chứa công thức tính giá hay điều kiện chuyển trạng thái.
- Service giữ nghiệp vụ và ranh giới transaction. Repository chỉ phục vụ module sở hữu dữ liệu.
- Module khác gọi service công khai hoặc nhận DTO/read model; không truy cập chéo repository hay trả entity JPA thẳng ra frontend.
- Chỉ tách interface/adapter khi có nhu cầu cụ thể, đặc biệt Gemini và Map; không tạo nhiều lớp trung gian cho mỗi thao tác CRUD.
- Service điều phối nằm trong module sở hữu use case. Nếu phát sinh phụ thuộc vòng, đổi hướng điều phối hoặc tách truy vấn cần thiết, không giải quyết bằng cho phép vòng phụ thuộc.
- `common` chỉ chứa thành phần dùng chung ổn định; không chứa quy tắc giá, trạng thái đơn, chấm điểm AI.

## 3. Luồng đặt xe và giao nhận

Liên hệ: FR-05–FR-10, UC-U02, UC-S01–UC-S04.

1. User gửi ID xe, thời gian và điểm nhận/trả; backend kiểm tra tài khoản, quyền và input.
2. `booking` mở transaction, yêu cầu `vehicle` khóa bản ghi xe theo cơ chế thống nhất rồi kiểm tra trạng thái và lịch đang bị chiếm.
3. `booking` tính tiền theo chính sách, lưu snapshot và tạo đơn; commit trước khi trả kết quả.
4. Staff xác nhận/từ chối qua `booking`. Điều kiện và trạng thái chiếm lịch sẽ theo state machine được chốt sau.
5. Khi giao/nhận, `operation` điều phối transaction: ghi hồ sơ, gọi `booking` chuyển trạng thái và `vehicle` cập nhật tình trạng khi phù hợp. Lỗi ở một bước phải rollback toàn bộ thay đổi liên quan.
6. `contract` và `invoice` cung cấp hồ sơ theo quyền; thời điểm phát hành còn mở, chưa mặc định tạo ở mọi bước.

Hướng chống đặt trùng: khóa bản ghi xe để tuần tự hóa các yêu cầu cùng xe, sau đó kiểm tra overlap bằng truy vấn đọc trạng thái hiện hành trong transaction. Kiểm tra lại trạng thái đơn khi cập nhật để chống hai Staff xử lý cùng lúc. Mọi thao tác làm chiếm/thay đổi lịch phải theo cùng giao thức khóa; cần quy định thứ tự khóa nhất quán và kiểm thử đồng thời trên MySQL thật ở giai đoạn triển khai. Không chỉ khóa các đơn tìm được vì khi chưa có đơn sẽ không có gì để khóa.

Khoảng thuê dùng điều kiện `newStart < existingEnd AND newEnd > existingStart`; thời gian đệm, trạng thái giữ lịch và hết hạn cần chốt trước khi cài đặt. Kết quả tìm xe trước đó không bảo đảm đặt thành công tại thời điểm sau.

## 4. Hai luồng AI

### Gợi ý xe — FR-12–FR-14, UC-G04

Input có cấu trúc/free text → backend validate → Gemini phân tích free text nếu cần → backend validate criteria → lấy catalog và availability → hard-filter → chấm điểm/xếp hạng trong `recommendation/engine` → Gemini giải thích dựa trên facts được cấp → backend kiểm tra output → trả kết quả.

- Xe, ID, score, giá và availability do backend quyết định. Không dùng output Gemini ghi đè các trường đó.
- Không có thời gian thuê thì kết quả chỉ thể hiện độ phù hợp, chưa xác nhận khả dụng.
- Gemini lỗi ở bước giải thích: trả ranking và score breakdown với thông báo rõ. Nếu bước hiểu free text lỗi và thiếu tiêu chí bắt buộc: yêu cầu người dùng nhập tiêu chí, không đoán.
- Không có xe phù hợp thì trả rỗng; không sinh xe hoặc ID giả.

### Lập hành trình — FR-15–FR-17, UC-U06

Input → validate → `location` lấy catalog ứng viên → Map adapter lấy tọa độ/ước tính tuyến cần thiết → Gemini đề xuất lịch theo candidates/constraints → backend kiểm tra → transaction ngắn lưu itinerary và các mục → trả DTO.

- Catalog nội bộ sở hữu location ID; dữ liệu bên ngoài cần chuẩn hóa/xác thực trước khi trở thành tham chiếu nghiệp vụ.
- Kiểm tra schema, ID, ngày, thứ tự, thời gian di chuyển và khung giờ khả thi theo dữ liệu có sẵn. Không coi validation JSON là đủ để chứng minh lịch khả thi.
- Gemini không gọi database; Map không quyết định đơn thuê hoặc giá xe.
- Không giữ transaction/khóa database trong khi chờ API ngoài. Trước khi lưu, kiểm tra lại các tham chiếu nội bộ và quyền sở hữu cần thiết.
- Map lỗi: không bịa distance/duration, không âm thầm lưu như hành trình đã kiểm tra tuyến. Nếu cho phép kế hoạch thiếu tuyến, phải có lựa chọn rõ ràng và trạng thái chưa kiểm chứng; chi tiết fallback còn mở.
- Gemini lỗi/kết quả sai: không lưu; hỗ trợ thử lại. Luồng tự sắp xếp địa điểm cần được chốt về phạm vi trước khi xây dựng.

## 5. Bảo mật, lỗi và vận hành

- Spring Security kiểm tra JWT và role; service kiểm tra chủ sở hữu đơn/hành trình cùng trạng thái tài khoản. Admin không mặc nhiên kế thừa mọi quyền User/Staff.
- Mật khẩu được hash; API key nằm ở backend qua cấu hình môi trường, không đưa vào frontend, Git hoặc log. Chỉ gửi dữ liệu cần thiết cho AI, không gửi giấy tờ/mật khẩu/token.
- Route guard của React hỗ trợ điều hướng; không thay kiểm tra quyền backend.
- Chốt chính sách hết hạn, đăng xuất/thu hồi token và khóa tài khoản trước khi triển khai auth; tránh coi xóa token ở frontend là đã thu hồi quyền server.
- API dùng lỗi nhất quán, thông báo dễ hiểu; lỗi validation, thiếu quyền, xung đột lịch và lỗi tích hợp được phân biệt. Hợp đồng response chi tiết thuộc giai đoạn API.
- Adapter giới hạn timeout, kích thước input/output và số lần gọi. Chỉ retry có giới hạn cho lỗi tạm thời phù hợp, tránh tăng chi phí/quota không kiểm soát.
- Log có mã liên hệ request để truy vết, không ghi bí mật; dashboard và audit nâng cao là phần mở rộng.

## 6. Kiểm chứng khi triển khai và trình bày báo cáo

Các ca kiểm thử trọng tâm: hai yêu cầu đặt trùng chỉ một thành công; User không xem đơn người khác; Staff không đổi role; Admin can thiệp vẫn qua quy tắc trạng thái; giao nhận rollback khi lỗi; recommendation không bịa xe; itinerary sai không được lưu; timeout API không gây sai dữ liệu. Đây là kế hoạch kiểm thử, chưa phải kết quả đã chạy.

Tài liệu kiến trúc, module và sơ đồ phục vụ Chương II; quy trình công cụ và kiểm thử phục vụ Chương III. Khung báo cáo tham khảo từ RAR chưa có trong repository và chưa được xác nhận là quy định chính thức.

Cách giải thích trước hội đồng: AI hỗ trợ hiểu yêu cầu và đề xuất phương án; backend kiểm chứng và chịu trách nhiệm về dữ liệu giao dịch. VS Code là công cụ phát triển; hệ thống chạy bằng React, Spring Boot và MySQL, không phụ thuộc việc editor đang mở.
