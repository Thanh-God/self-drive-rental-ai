# Cải thiện đăng ký, hồ sơ và điều hướng — 13/10/2026

Phạm vi được điều chỉnh theo yêu cầu người dùng: cải thiện luồng hiện có, không mở rộng toàn bộ cơ chế xác thực. Không migration, dependency mới, đổi dữ liệu MySQL gốc hoặc điều kiện đặt xe trong lượt này. C11-A3/A4 còn pending.

## Thay đổi

| Phần | Hành vi cuối |
| --- | --- |
| Mật khẩu | Tạo/đổi mật khẩu cần ít nhất 8 ký tự, chữ hoa, chữ thường, số và ký tự đặc biệt theo lựa chọn người dùng; tối đa 72 byte UTF-8 để phù hợp BCrypt. Chặn một danh sách nhỏ mật khẩu phổ biến, không tuyên bố kiểm tra toàn bộ mật khẩu bị lộ. Mật khẩu cũ vẫn đăng nhập được. |
| Rate limit | Cửa sổ 15 phút: login IP 30/email chuẩn hóa 10; đăng ký IP 10/email 5; đổi mật khẩu IP 15/tài khoản 5. Tính cả yêu cầu thành công và thất bại đi tới controller; trả 429 khi vượt ngưỡng. |
| Đổi mật khẩu | Giữ yêu cầu mật khẩu hiện tại, kiểm tra mật khẩu mới, thêm nhập lại và hiện/ẩn. Chặn gửi lặp khi đang chờ. Thành công thu hồi JWT cũ bằng tokenVersion và đăng xuất thiết bị hiện tại. |
| Hồ sơ | Email chỉ đọc; số điện thoại tùy chọn được chuẩn hóa và kiểm tra 7–15 chữ số, có thể bắt đầu bằng +. Đây là kiểm tra định dạng, chưa xác minh sở hữu. |
| UI desktop | Bỏ tagline nhỏ trên header, dùng Tìm xe và liên kết nghiệp vụ USER, focus teal rõ ràng; đưa badge xe vào trong ảnh và hiển thị chú thích ảnh minh họa. Giữ hệ màu Urban và ảnh đã kiểm nguồn. |

AuthController/UserController áp dụng limiter; AccountService áp dụng chính sách server. PasswordField và passwordPolicy dùng chung ở RegisterPage/ApiProfilePage. AuthSecurityHttpServerTest chứng minh HTTP/DB/JWT; authUiReview.test.js kiểm mounted DOM; runners trong scripts/coordination/auth-ui-review kiểm MySQL và trình duyệt thật.

Role USER, BCrypt cost 12, email chuẩn hóa/unique và tokenVersion đã có; lượt này kiểm chứng lại, không coi nhận xét hoặc ảnh chụp là bằng chứng chúng bị thiếu. AccountAssignmentHttpServerTest chỉ đổi mật khẩu fixture theo chính sách mới, giữ assertions.

## Giới hạn và phần tiếp theo

Limiter trong bộ nhớ của một tiến trình: restart làm mất bộ đếm, chưa dùng cho nhiều replica. Đọc remoteAddr, không tin X-Forwarded-For; reverse proxy cần chính sách riêng. Chưa có CAPTCHA, kiểm tra toàn bộ mật khẩu bị lộ hoặc đánh giá tuân thủ NIST. Danh sách khóa bị giới hạn 10.000 và fail closed khi đầy.

Xác minh email, token 24 giờ dùng một lần, OTP đổi mật khẩu và thông báo email **PENDING**, chưa gửi Gmail thật và chưa chặn đặt xe theo email. Tách thành lượt riêng để chốt migration, tài khoản cũ, lỗi gửi mail và kiểm thử provider. Giữ luồng đổi mật khẩu hiện tại giúp tránh thay đổi quá nhiều project.

Cổng chạy local theo scripts: frontend API 5173, backend 8080, MySQL KLTN 33385. Gmail SMTP 587 là cổng gửi mail STARTTLS, không thay các cổng này. APP_BASE_URL tương lai phải trỏ URL frontend thực tế; credentials do người vận hành cấu hình riêng, không đưa vào Git. Không thêm MAIL_* giả để báo gửi mail PASS.

## Bằng chứng

Thư mục lượt: `.runtime/coordination-auth-ui-review-20261013/`. Backend clean copy verify: 149 reported, 135 executed, 14 skipped theo cấu hình cũ; các skip không tính PASS. Native MySQL HTTP 6/6, zero skip; JAR 123 entries đối chiếu byte với compiled classes/resources. Browser thật 29 assertions trên fixture riêng, desktop 1280/1440/1920; kiểm gửi đơn, form và JWT thu hồi thực tế. Frontend 83 tests cùng lint và build demo/API được ghi trong ACCEPTANCE của lượt.

Lỗi repackage target workspace và các lượt thử thất bại được giữ trong evidence; kết quả build cuối sử dụng bản backend copy sạch có source đối chiếu với workspace. Không dùng JAR target cũ làm bằng chứng. Fixture cuối dừng, volume KEEP; backend/frontend do lượt tạo đã dừng. Không push và không tuyên bố toàn hệ thống hoặc toàn bộ đề xuất email đã hoàn tất.

## Điều chỉnh đăng xuất và đăng ký theo phản hồi tiếp theo

Lượt `.runtime/coordination-logout-register-20261013/` tiếp nối baseline efb7593. Trước sửa, AuthContext chỉ clearSession sau khi logout API thành công; lỗi mạng/server giữ token và user local. Mounted regression đã tái hiện token còn tồn tại khi API pending. Nay lấy token cần thu hồi trước khi xóa phiên trên thiết bị ngay lập tức; Navbar và WorkspaceTopbar chuyển tới login ngay. Thành công/401 không báo lỗi; server/network/403 lỗi vẫn giữ trạng thái guest và cảnh báo chưa xác nhận thu hồi server. Không tuyên bố mọi phiên đã bị thu hồi khi API thất bại. Logout 403 không kích hoạt redirect unauthorized dùng cho nghiệp vụ khác; các API 403 khác vẫn giữ contract cũ.

Đăng nhập/đăng ký tiếp theo vẫn đợi logout cũ kết thúc (Axios timeout hiện có 20 giây), tránh phản hồi revoke cũ ảnh hưởng phiên vừa tạo. Logout thất bại không chặn vĩnh viễn đăng nhập lại; generation guards giữ phiên mới khỏi phản hồi cũ.

Theo yêu cầu mới, đăng ký chỉ còn Họ và tên, Email, Mật khẩu: bỏ nhập lại mật khẩu; giữ validation server/client, hiện/ẩn và chống gửi lặp. Form đổi mật khẩu giữ nhập lại mật khẩu mới. Ảnh tham khảo chỉ dùng để đơn giản hóa form, không triển khai Google OAuth/CAPTCHA hoặc gửi email giả. Desktop và policy mật khẩu không đổi.

Evidence cuối và commit xem ACCEPTANCE/HANDOFF trong thư mục lượt mới; không sửa biên bản lượt trước. C11-A3/A4 và email/OTP tiếp tục pending.
