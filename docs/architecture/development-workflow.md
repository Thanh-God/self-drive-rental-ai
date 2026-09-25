# Quy trình công cụ đơn giản cho KLTN

## Nguyên tắc đã chốt

VS Code là nơi viết, chạy và debug cả backend Java và frontend React. Không phụ thuộc NetBeans hoặc cấu hình Maven đi kèm NetBeans để chạy dự án. Chỉ bổ sung công cụ khi giúp hoàn thành một việc cụ thể và người dùng có thể hiểu quy trình đó.

| Công cụ | Vai trò | Mức cần thiết |
|---|---|---|
| VS Code | Mở repository, sửa Java/React/tài liệu, chạy terminal/debug | Môi trường phát triển thống nhất |
| JDK + Maven Wrapper | Biên dịch, test và chạy Spring Boot | Bắt buộc khi triển khai backend |
| Node.js + npm | Cài dependency, chạy/build React | Bắt buộc khi triển khai frontend |
| MySQL Server | Lưu dữ liệu ứng dụng | Bắt buộc khi chạy nghiệp vụ |
| Trình duyệt | Xem giao diện và demo/kiểm thử | Bắt buộc |
| Git + GitHub | Lịch sử thay đổi và bản sao mã nguồn | Công cụ quản lý phiên bản |
| DBeaver | Xem bảng và truy vấn phục vụ học/debug | Tùy chọn; dùng một GUI database là đủ |
| Word / PowerPoint | Báo cáo / slide bảo vệ | Dùng khi đến giai đoạn tài liệu tương ứng |
| Figma, Canva, Google Drive | Thiết kế hoặc cộng tác khi có yêu cầu | Không là điều kiện chạy/demo |
| Docker, NetBeans, Workbench, SSMS | Không nằm trong quy trình chạy mặc định | Không phải học hoặc mở cùng dự án |

MySQL Workbench có thể thay DBeaver nếu cần, không yêu cầu dùng cả hai. SSMS không dùng thay MySQL. Docker chỉ xem xét nếu có nhu cầu triển khai cụ thể; ưu tiên hướng chạy local trực tiếp để ít tầng vận hành.

## Tình trạng khảo sát máy ngày 25/09/2026

- Đã chạy được Git 2.50.1, Java/javac 23, Node 24.11.0, npm 11.6.1 và Python 3.12.0.
- Maven 3.9.9 hiện được tìm thấy bên trong NetBeans; dự án sẽ có Maven Wrapper để không phụ thuộc đường dẫn IDE đó.
- Đã phát hiện VS Code, DBeaver, MySQL Workbench và Microsoft Office. Có ứng dụng không có nghĩa mọi chức năng đã được kiểm thử.
- Chưa xác nhận MySQL Server hoạt động. XAMPP trên máy cung cấp MariaDB 10.4.32; không tự thay stack MySQL đã chốt bằng MariaDB.
- Docker CLI có mặt nhưng không kết nối được engine trong lần khảo sát; Docker không là điều kiện bắt buộc của quy trình này.
- Chưa chốt phiên bản JDK/Spring Boot cho project; phiên bản đang cài không tự động là phiên bản chuẩn. Chọn phiên bản tương thích và ghi cố định khi khởi tạo.

## Cách chạy dự kiến khi ứng dụng đã được khởi tạo

1. Mở một thư mục KLTN trong VS Code, không cần mở NetBeans.
2. Bảo đảm MySQL Server chạy và cấu hình môi trường backend hợp lệ.
3. Chạy backend từ thư mục backend bằng Maven Wrapper; backend áp dụng Flyway và kết nối MySQL.
4. Chạy frontend từ thư mục frontend bằng npm trong terminal thứ hai.
5. Mở URL frontend trong trình duyệt. React gửi REST request đến backend; backend truy cập database và API ngoài.
6. Khi có lỗi, xem terminal backend/frontend tương ứng; mở DBeaver chỉ nếu cần kiểm tra dữ liệu.

Đây là trình tự dự kiến, chưa phải hướng dẫn lệnh chạy hiện có. Giai đoạn khởi tạo sẽ bổ sung lệnh chính xác, URL, cấu hình môi trường mẫu không chứa bí mật và cấu hình Run/Debug dễ dùng; kiểm thử trước khi đưa vào README. Hướng dẫn sẽ giải thích chức năng từng tiến trình, không chỉ đưa các lệnh để sao chép.

## Việc cần làm ở giai đoạn khởi tạo

- Kiểm tra extension Java/React cần thiết trong VS Code và sự tương thích JDK/Spring Boot.
- Chuẩn bị MySQL Server và database dành riêng cho demo; không sử dụng database cá nhân có sẵn.
- Thêm Maven Wrapper, cấu hình backend và frontend cùng lockfile; không cài dependency ở Giai đoạn 2.
- Kiểm thử quy trình trên máy từ trạng thái dừng đến chạy thành công, gồm migration/seed và trường hợp API ngoài thiếu key.
- Ghi lại quy trình demo dễ lặp lại: khởi động dịch vụ, đăng nhập theo actor, chạy nghiệp vụ và hai AI, dừng ứng dụng.

Mã nguồn và migration nằm trong Git; dữ liệu runtime nằm trong MySQL; API key qua môi trường; bản báo cáo/slide là artifact riêng. Không cần đưa mọi dữ liệu vào repository hoặc chuyển qua nhiều ứng dụng để một chức năng hoạt động.
