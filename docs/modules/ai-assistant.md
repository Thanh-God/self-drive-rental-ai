# Trợ lý KDrive — chatbox gợi ý xe

Nút Trợ lý KDrive dành cho USER đã đăng nhập, ở góc dưới bên phải các trang desktop: trang chủ, danh sách/chi tiết xe, danh sách/chi tiết/tạo đơn thuê và hồ sơ. Không hiển thị cho Guest/Staff/Admin hoặc trang đăng nhập, chứng từ. Mobile chưa được triển khai; dưới768px nút được ẩn.

Chatbox mở theo thao tác người dùng, có thu nhỏ/đóng, Escape và trả focus về nút mở. Bắt đầu lại xóa nhu cầu và kết quả. Biểu mẫu/kết quả chỉ giữ trong bộ nhớ khi chuyển trang SPA; tải lại trang, đăng xuất, đổi tài khoản hoặc đổi phiên sẽ xóa. Không lưu hội thoại trong database, localStorage hay sessionStorage. Khi sửa nhu cầu/reset/đổi phiên, phản hồi đang chạy bị hủy và không được gắn vào nhu cầu/phiên mới.

Lượt này chỉ kết nối [API AI1](ai-recommendation.md): ngày nhận/trả, chi nhánh, số người gồm tài xế, tổng ngân sách và ưu tiên hộp số/tiện nghi. Không có ô nhập câu tự nhiên hoặc gọi nhà cung cấp AI. Nếu mở lần đầu từ URL có thông tin chuyến đi, biểu mẫu nhận các ngày và chi nhánh đó; chuyển trang sau đó không ghi đè nhu cầu đang nhập.

API mode tải chi nhánh và tiện nghi từ backend; lỗi danh mục có nút thử lại, không dùng seed/demo thay thế. Kết quả trả tối đa3 xe đầu theo thứ tự server, hiển thị tổng tiền gồm phí tuyến và lý do dựa trên facts. Xem xe chuyển tiếp ngày nhận/trả, chi nhánh và ngân sách vào trang xe. Không áp dụng ưu tiên mềm thành bộ lọc cứng khi chuyển tiếp. Không đặt/hủy/sửa đơn qua chatbox; quote/create vẫn kiểm tra lại GPLX, giá và lịch.

Không có xe thì báo rõ để người dùng tự sửa tiêu chí. Backend chưa bật hoặc lỗi thì giữ biểu mẫu, hiển thị lỗi và đường dẫn Tìm xe. Phản hồi sai requestId/schema bị từ chối. Demo mode chỉ thông báo chưa kết nối, không gọi API hoặc tạo gợi ý giả.

Backend AI1 vẫn mặc định tắt bằng AI_RECOMMENDATION_ENABLED; chưa thay đổi điều kiện nghiệm thu core hoặc tự bật trên môi trường đang chạy. Giai đoạn AI2 hiểu ngôn ngữ tự nhiên và cấu hình provider/model/ngân sách/retention được tách riêng, chưa triển khai theo lựa chọn người dùng ở lượt này.
