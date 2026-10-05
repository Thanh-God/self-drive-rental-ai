# Database và migration

## Nguồn schema duy nhất

Migration Flyway chỉ đặt tại [backend/src/main/resources/db/migration](../backend/src/main/resources/db/migration/). Khi khởi tạo Spring Boot, cấu hình Flyway dùng nguồn này; Hibernate kiểm tra schema (`validate`), không dùng cơ chế tự tạo/cập nhật schema thay migration.

Hiện có V1__rental_schema.sql: 25 bảng nghiệp vụ. Application.yml bật Flyway, Hibernate validate và clean-disabled. Audit 29/09/2026 đã chạy migration qua integration test H2 MySQL mode; chưa xác nhận MySQL runtime trong phiên này.

Quy ước V<version>__<description>.sql, phiên bản tăng và không trùng. V1 thực tế tên V1__rental_schema.sql. Không sửa migration đã áp dụng vào môi trường dùng chung; tạo migration tiếp theo. Không bật clean/xóa database trong quy trình khởi động bình thường.

## Vai trò các thư mục

| Nơi lưu | Nội dung |
|---|---|
| `backend/src/main/resources/db/migration/` | SQL thay đổi schema và dữ liệu tham chiếu cần thiết, được quản lý phiên bản |
| `database/` | Hướng dẫn chuẩn bị database, seed demo, backup/restore khi được triển khai; không chứa nguồn DDL thứ hai |
| `docs/` | Kiến trúc, ERD, từ điển dữ liệu và quy tắc nghiệp vụ; tài liệu không thay migration thực thi |

Đã bỏ placeholder `database/migrations/`. Không duy trì `schema.sql` chỉnh tay song song. Nếu cần xuất schema cho báo cáo thì phải ghi là bản xuất tham khảo từ database đã migrate, không dùng để khởi tạo thay Flyway.

## Dữ liệu demo và vận hành

- Dữ liệu tham chiếu bắt buộc có thể đi cùng migration; dữ liệu demo không chạy tự động trên mọi môi trường.
- DemoSeed chỉ chạy khi SEED_ENABLED=true, yêu cầu SEED_PASSWORD ít nhất 12 ký tự; nếu users đã có dữ liệu thì bỏ qua toàn bộ seed. Không dùng cơ chế này để reset/repair database đang dùng. Seed tạo 4 tài khoản giả, 2 chi nhánh dn/hn, Staff phân công, 4 tuyến, hãng/loại và 3 xe; không tạo GPLX hoặc booking.
- Mật khẩu seed qua môi trường, không ghi bí mật vào Git. Phí khác chi nhánh 1.500.000 VND trong seed chỉ là mẫu kiểm thử, không phải giá được doanh nghiệp phê duyệt.
- Biến kết nối DB_URL/DB_USER/DB_PASSWORD theo application.yml; dùng database riêng cho ứng dụng/test. Hướng dẫn runtime tại [quy trình công cụ](../docs/architecture/development-workflow.md). Chưa có quy trình backup/restore được kiểm chứng.
- Mục tiêu MySQL; MariaDB trong XAMPP không được mặc định xem là môi trường chuẩn. GUI như DBeaver chỉ hỗ trợ quan sát, không tự sửa schema bỏ qua migration.

## Ngân sách bảng

Tối đa 30 bảng tính cả kỹ thuật. Baseline 20 bảng ngày 26/09 đã được mở rộng thành 25 bảng nghiệp vụ trong V1; cộng flyway_schema_history là 26. Danh sách/quan hệ/phần chỉ có schema tại [thiết kế database](../docs/database/database-design.md). Không tạo bảng AI huấn luyện khi chưa chốt mô hình và dữ liệu. Quyết định nghiệp vụ chỉ duy trì tại [sổ quyết định](../docs/architecture/decisions.md).
