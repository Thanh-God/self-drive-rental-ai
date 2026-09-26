# Database và migration

## Nguồn schema duy nhất

Migration Flyway chỉ đặt tại [backend/src/main/resources/db/migration](../backend/src/main/resources/db/migration/). Khi khởi tạo Spring Boot, cấu hình Flyway dùng nguồn này; Hibernate kiểm tra schema (`validate`), không dùng cơ chế tự tạo/cập nhật schema thay migration.

Thư mục này hiện chỉ có placeholder; chưa có schema hoặc SQL để chạy. Không tự chạy SQL trong Giai đoạn 2.

Quy ước dự kiến: `V1__initial_schema.sql`, `V2__describe_change.sql`, số phiên bản tăng và không trùng. Ví dụ chỉ minh họa cách đặt tên, chưa tồn tại các file đó. Không sửa migration đã áp dụng vào môi trường dùng chung; tạo migration tiếp theo. Không bật clean/xóa database trong quy trình khởi động bình thường.

## Vai trò các thư mục

| Nơi lưu | Nội dung |
|---|---|
| `backend/src/main/resources/db/migration/` | SQL thay đổi schema và dữ liệu tham chiếu cần thiết, được quản lý phiên bản |
| `database/` | Hướng dẫn chuẩn bị database, seed demo, backup/restore khi được triển khai; không chứa nguồn DDL thứ hai |
| `docs/` | Kiến trúc, ERD, từ điển dữ liệu và quy tắc nghiệp vụ; tài liệu không thay migration thực thi |

Đã bỏ placeholder `database/migrations/`. Không duy trì `schema.sql` chỉnh tay song song. Nếu cần xuất schema cho báo cáo thì phải ghi là bản xuất tham khảo từ database đã migrate, không dùng để khởi tạo thay Flyway.

## Dữ liệu demo và vận hành

- Dữ liệu tham chiếu bắt buộc có thể đi cùng migration; dữ liệu demo không chạy tự động trên mọi môi trường.
- Cơ chế seed demo còn chờ thiết kế: chỉ bật rõ ràng ở môi trường demo, có quy tắc tránh nhân bản, dùng dữ liệu giả và không lưu bí mật vào Git. Không tạo thư mục migration thứ hai để chứa seed demo.
- Hướng dẫn tạo database/tài khoản, cấu hình kết nối, migration, seed và backup/restore sẽ bổ sung cùng mã ứng dụng và được kiểm thử. Chưa có lệnh khởi tạo đáng tin cậy để thực hiện ở thời điểm này.
- Mục tiêu MySQL; MariaDB trong XAMPP không được mặc định xem là môi trường chuẩn. GUI như DBeaver chỉ hỗ trợ quan sát, không tự sửa schema bỏ qua migration.

## Ngân sách bảng

Tối đa 30 bảng, tính cả bảng kỹ thuật như lịch sử Flyway. Ngày 26/09/2026 đã duyệt 20 bảng nghiệp vụ cơ sở, cộng lịch sử Flyway là 21 bảng; chưa thêm bảng tùy chọn. Xem [thiết kế cơ sở và chính sách đã duyệt](../docs/database/database-design.md). ERD chi tiết, từ điển dữ liệu và migration chưa hoàn tất; các thông số còn mở được ghi rõ trong thiết kế và sổ quyết định.
