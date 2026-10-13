# Phát triển và vận hành

## Công cụ

JDK21 và Maven Wrapper cho backend; Node/npm cho frontend; MySQL8.4 lưu dữ liệu. Docker là cách chạy MySQL local khi dùng container; IDE không tham gia runtime. Git quản lý source/tests/tài liệu kỹ thuật. DBeaver hoặc công cụ tương đương có thể dùng để đọc schema.

## Chạy dự án

Xem [README](../../README.md) và [frontend](../../frontend/README.md) cho lệnh theo shell. Cấu hình backend bằng biến môi trường; Spring Boot không tự đọc backend/.env.local. Các script khởi động nạp file env và không dừng/reset Docker. Chạy frontend API qua /api/v1 và Vite proxy trỏ đúng backend. Kiểm tra cổng trước khởi động, giữ terminal của từng dịch vụ; sau thay source/backend env, khởi động lại dịch vụ tương ứng.

Không commit credentials, env riêng, database dump, dependency hoặc build output. Không dùng database của dự án khác. Seed chỉ bật khi chủ động cấu hình, không dùng để reset database đang vận hành.

## Kiểm thử

Backend: tại backend dùng ./mvnw.cmd verify (PowerShell) hoặc ./mvnw verify (Git Bash), JDK21. Frontend: tại frontend dùng npm test, npm run lint, npm run build; build riêng VITE_DATA_MODE=demo và api. Mã test/runner được quản lý trong Git để tái chạy.

Test ghi dữ liệu phải dùng schema/instance cô lập và kiểm tra marker/host/port trước khi chạy. H2 không thay chứng minh transaction/snapshot trên MySQL. Browser API cần backend/MySQL thật, không fallback sang demo. Chỉ dừng dịch vụ do chính lượt test tạo; giữ dữ liệu vận hành. Runner và chính sách fixture xem [scripts operations](../../scripts/operations/README.md).

## Database

Migration duy nhất tại backend/src/main/resources/db/migration. Giữ Flyway validation, Hibernate validate, clean-disabled và không baseline tự động. Không sửa migration đã áp dụng; trước nâng cấp database có dữ liệu phải kiểm history/checksum/schema và backup. MySQL DDL có thể tồn tại một phần sau lỗi, không tự repair/clean hoặc giả định rollback toàn migration.

## Quản lý tài liệu

Tài liệu chia sẻ mô tả chức năng, API, kiến trúc, cách cấu hình và chạy test. Nhật ký điều phối, kế hoạch từng lượt, kết quả kiểm tra, artifact/hash/SHA và biên bản nội bộ được lưu ở thư mục local bị Git bỏ qua. Không ghi tiến trình làm việc của agent vào README hoặc docs công khai.
