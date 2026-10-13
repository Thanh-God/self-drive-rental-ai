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

## Phản hồi đổi mật khẩu — 13/10/2026

Lượt `.runtime/coordination-password-feedback-20261013/`: giữ chính sách 8 ký tự, chữ hoa/thường, số/ký tự đặc biệt, giới hạn 72 byte UTF-8 và chặn mật khẩu phổ biến. Frontend liệt kê điều kiện thiếu và hiển thị đồng thời lỗi nhập lại chưa khớp. Ảnh người dùng có mật khẩu chỉ chứa số và confirmation khác nhau, nên không phải bằng chứng backend từ chối mật khẩu hợp lệ.

Sau PUT /me/password thành công (HTTP 200 theo controller hiện tại), xóa phiên local rồi hiện native window.alert với nút OK, yêu cầu đăng nhập lại; không thông báo thành công khi pending hoặc lỗi. Giữ nguyên backend/tokenVersion, không thêm thư viện/email/OTP.

Frontend 108/108, zero skip; lint và demo/API build đạt. Browser thực trên fixture cô lập kiểm ca âm, mật khẩu hiện tại sai, native alert, xóa token, token cũ 401, mật khẩu cũ 401 và mới 200. Dịch vụ do lượt tạo và fixture đã dừng; volume KEEP, DB gốc không ghi. Chi tiết/hash/commit ở HANDOFF và ACCEPTANCE của lượt. C11-A3/A4 đã hoàn tất theo bằng chứng C11 tương ứng; trạng thái pending trong đoạn lịch sử phía trên là tại thời điểm viết đoạn đó.

## Điều tra timeout hồ sơ — PARTIAL

Lượt `.runtime/coordination-profile-timeout-20261013/`: người dùng báo timeout20s với đổi mật khẩu, điện thoại, GPLX trên 127.0.0.1:5173/user/profile. Tại thời điểm kiểm tra, backend8080/frontend5173/MySQL33385 đang chạy; GET vehicles200 và PUT không token401 phản hồi dưới0.1s qua backend/proxy. Vite thực sự dùng API /api/v1. MySQL đọc kiểm tra có0 transaction/0 lock wait; thread dump không thấy request đang bị chặn. Đây chỉ là snapshot, không loại trừ lỗi gián đoạn.

JAR hiện trên backend/target có0 BOOT-INF/classes entries, khác bản backend nghiệm thu123entries; tiến trình Java đã chạy trước đó nên không suy nguyên nhân timeout từ file trên đĩa. Chưa restart tiến trình người dùng hoặc sửa DB gốc.

Đổi thông báo Axios timeout sang tiếng Việt: chưa xác nhận đã lưu, tải lại/readback trước retry; mật khẩu cần thử đăng nhập lại. Không tăng timeout, retry tự động, hoặc giả thành công. Frontend110/110, lint/demo/APIbuild và19assertions backend/MySQL-browser cô lập đạt, gồm điện thoại readback, GPLX HTTP/readback, đổi mật khẩu/sessionrevocation. GPLX ở lượt này được kiểm qua HTTP thật, không tuyên bố thêm UI submit GPLX.

Nguyên nhân phiên người dùng NOT VERIFIED; chờ Request URL/Method/Status trong Network của request timeout, không thu thập token/password. Chỉ PASS phạm vi thông báo và fixture, toàn lỗi người dùng vẫn PARTIAL.
