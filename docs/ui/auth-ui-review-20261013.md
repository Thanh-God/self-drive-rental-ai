# Đăng ký, đăng nhập và hồ sơ

Đăng ký gồm Họ và tên, Email, Mật khẩu; tài khoản mới có roleUSER. Email chuẩn hóa và kiểm trùng ở backend. Mật khẩu mới cần ít nhất8ký tự, có chữ hoa/thường, số và ký tự đặc biệt; tối đa72byteUTF-8 và không thuộc danh sách mật khẩu phổ biến. Tài khoản cũ vẫn dùng mật khẩu hiện có để đăng nhập.

Trang Hồ sơ/GPLX cho phép sửa họ tên, số điện thoại và thông tin bằng lái; email chỉ đọc. Số điện thoại7–15chữ số, có thể bắt đầu bằng+. Đây là kiểm tra định dạng, không xác minh sở hữu số điện thoại. GPLX phải phù hợp hệ/hạng/hộp số, còn hạn theo luật nghiệp vụ; Staff đối chiếu trước giao xe.

Đổi mật khẩu cần mật khẩu hiện tại, mật khẩu mới và nhập lại mật khẩu mới. Form nêu các điều kiện còn thiếu và lỗi xác nhận không khớp. Sau khi API thành công, phiên local bị xóa, token cũ bị thu hồi và trình duyệt hiện thông báoOK yêu cầu đăng nhập lại. Lỗi hoặc request đang chờ không hiện thông báo thành công.

Đăng xuất xóa phiên trên thiết bị ngay, đồng thời gọi API thu hồi token. Nếu mạng/server lỗi, giao diện cảnh báo chưa xác nhận thu hồi phía server. Đăng nhập tiếp theo đợi request đăng xuất cũ kết thúc để tránh phản hồi cũ ảnh hưởng phiên mới.

Các thao tác đăng ký/đổi mật khẩu có giới hạn gửi request và chặn gửi lặp. Mật khẩu có nút hiện/ẩn và autocomplete phù hợp. Email verification, emailOTP/SMS và GoogleOAuth chưa được tích hợp.

Nếu máy chủ không phản hồi trong thời gian cho phép, kết quả thao tác chưa được xác nhận. Tải lại thông tin trước khi thử gửi lại; khi đổi mật khẩu, thử đăng nhập lại để kiểm tra kết quả. Không tự động gửi lại thao tác ghi chỉ vì timeout.
