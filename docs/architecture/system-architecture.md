# Kiến trúc hệ thống

KDrive sử dụng React SPA, Spring Boot modular monolith và MySQL. Phạm vi chức năng nằm trong [yêu cầu hệ thống](../requirements/system-scope.md); chính sách nghiệp vụ tại [sổ quyết định](decisions.md).

## 1. Mục tiêu và hình thức triển khai

Một React SPA gọi một Spring Boot REST API; backend gồm các module nghiệp vụ trong cùng ứng dụng, truy cập một MySQL database bằng JPA/Hibernate. Đây là modular monolith: phân chia trách nhiệm trong mã nguồn nhưng build/triển khai backend như một đơn vị.

Phù hợp đồ án cá nhân khoảng ba tháng: giao dịch đặt xe có thể xử lý trong một database, ít thành phần phải vận hành, dễ theo dõi lỗi. Đổi lại, phải kiểm soát phụ thuộc module và kiểm thử tránh thay đổi một module làm hỏng luồng khác. Không bổ sung microservices, message broker hoặc database riêng cho từng module.

[Sơ đồ component và cách đọc](../diagrams/component-diagram.md).

Trong phát triển, VS Code mở repository; frontend/backend chạy riêng qua HTTP. MySQL là dịch vụ riêng. Cấu hình hiện tại: Vite 5173, backend 8080, CORS mặc định http://127.0.0.1:5173; cấu hình chính xác nằm trong application.yml và frontend/src/api/client.js. IDE không tham gia runtime.

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
4. Staff xác nhận/từ chối qua `booking`, theo chi nhánh nhận. PENDING còn hạn, CONFIRMED và IN_PROGRESS chiếm lịch; phải kiểm tra cả chuỗi chi nhánh.
5. Khi giao/nhận, `operation` điều phối transaction: ghi hồ sơ, gọi `booking` chuyển trạng thái và `vehicle` cập nhật tình trạng khi phù hợp. Lỗi ở một bước phải rollback toàn bộ thay đổi liên quan.
6. `RentalWorkflow` hiện phát hành hợp đồng khi CONFIRMED, hóa đơn khi COMPLETED trong cùng transaction với chuyển trạng thái. Hai hồ sơ là snapshot, không xác nhận đã thu tiền.

Hướng chống đặt trùng: khóa bản ghi xe để tuần tự hóa các yêu cầu cùng xe, sau đó kiểm tra overlap bằng truy vấn đọc trạng thái hiện hành trong transaction. Kiểm tra lại trạng thái đơn khi cập nhật để chống hai Staff xử lý cùng lúc. Mọi thao tác làm chiếm/thay đổi lịch phải theo cùng giao thức khóa; cần quy định thứ tự khóa nhất quán và kiểm thử đồng thời trên MySQL thật ở giai đoạn triển khai. Không chỉ khóa các đơn tìm được vì khi chưa có đơn sẽ không có gì để khóa.

Khoảng thuê dùng điều kiện `newStart < existingEnd AND newEnd > existingStart`. PENDING giữ tối đa 2 giờ, không vượt giờ nhận; khoảng đệm/no-show/gia hạn chưa có. Kết quả tìm xe/báo giá không bảo đảm đặt thành công về sau.

## 4. Hai luồng AI

Phần này mô tả phương án thiết kế ban đầu, chưa có adapter/engine/API thực thi. Provider hoặc mô hình tự train chưa chốt (AD-13); quyết định cuối không được suy ra từ tên folder `gemini`. Các ranh giới kiểm chứng dữ liệu dưới đây vẫn phải được giữ khi thay provider.

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
- Map lỗi/thiếu tuyến: MVP đã chốt dừng/thử lại, không bịa distance/duration và không lưu kế hoạch thiếu dữ liệu kiểm chứng.
- AI lỗi/kết quả sai: không lưu, hỗ trợ thử lại; chưa có trình chỉnh sửa thủ công đầy đủ trong MVP.

## 5. Bảo mật, lỗi và vận hành

- Spring Security kiểm tra JWT và role; service kiểm tra chủ sở hữu đơn/hành trình cùng trạng thái tài khoản. Admin không mặc nhiên kế thừa mọi quyền User/Staff.
- Mật khẩu được hash; API key nằm ở backend qua cấu hình môi trường, không đưa vào frontend, Git hoặc log. Chỉ gửi dữ liệu cần thiết cho AI, không gửi giấy tờ/mật khẩu/token.
- Route guard của React hỗ trợ điều hướng; không thay kiểm tra quyền backend.
- Hiện có TTL 30 phút mặc định, không refresh; TokenFilter kiểm tra trạng thái và token_version mỗi request; logout/đổi mật khẩu/khóa tăng phiên bản. Frontend lưu token localStorage. Cần kiểm thử thêm phiên hết hạn và các request đang chạy khi thu hồi.
- API dùng lỗi nhất quán, thông báo dễ hiểu; lỗi validation, thiếu quyền, xung đột lịch và lỗi tích hợp được phân biệt. Hợp đồng response chi tiết thuộc giai đoạn API.
- Adapter giới hạn timeout, kích thước input/output và số lần gọi. Chỉ retry có giới hạn cho lỗi tạm thời phù hợp, tránh tăng chi phí/quota không kiểm soát.
- Log có mã liên hệ request để truy vết, không ghi bí mật; dashboard và audit nâng cao là phần mở rộng.

## 6. Chiến lược kiểm thử

Các ca cần kiểm chứng: đặt trùng đồng thời trên MySQL; hai Staff xử lý đồng thời; rollback lỗi phát hành; hết hạn/thu hồi phiên; sự cố ngoài thời gian giữ xe; AI không bịa facts và không lưu hành trình sai. Kết hợp unit, integration và browser test; MySQL và H2 phục vụ các mục đích kiểm tra khác nhau.


Cách giải thích trước hội đồng: AI hỗ trợ hiểu yêu cầu và đề xuất phương án; backend kiểm chứng và chịu trách nhiệm về dữ liệu giao dịch. VS Code là công cụ phát triển; hệ thống chạy bằng React, Spring Boot và MySQL, không phụ thuộc việc editor đang mở.
