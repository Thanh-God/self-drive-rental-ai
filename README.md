# Hệ thống cho thuê xe tự lái tích hợp AI hỗ trợ lựa chọn phương tiện và lập kế hoạch hành trình cá nhân hóa

## Trạng thái dự án (Audit 29/09/2026)

- **Phạm vi/kiến trúc:** đã có baseline được duyệt; hợp nhất đa chi nhánh, GPLX và sự cố. Source giữ kiến trúc lớn nhưng có drift ranh giới module cần xử lý.
- **Database/backend:** đã có Flyway V1 (25 bảng nghiệp vụ), Spring Boot 3.5.16/Java 21, API auth/thuê xe/giao nhận/hồ sơ/sự cố/quản trị một phần. Đang thực hiện, chưa nghiệm thu toàn bộ core.
- **Frontend:** có UI demo và màn hình API; AI, itinerary, locations, dashboard chưa có backend. Kết quả QA desktop 27/09 chỉ là biên bản bản demo cũ.
- **AI:** chưa triển khai; provider/mô hình tự train chưa chốt, bắt đầu sau khi core hoàn thiện.
- **Kiểm tra 29/09:** frontend 6/6 test, backend 6/6 test H2, hai build PASS; ESLint 0 errors/14 warnings. Chưa kiểm thử concurrency MySQL và browser E2E API trong phiên audit.
- Xem [audit chi tiết và backlog](docs/architecture/system-architecture.md#7-audit-hiện-trạng-ngày-29092026), [quyết định chuẩn](docs/architecture/decisions.md), [schema hiện tại](docs/database/database-design.md).

## Chạy demo giao diện

Mở terminal tại `E:\AI\BERT_Project\codepython\KLTN\frontend`. Chạy `npm ci` nếu chưa cài thư viện, sau đó `npm run dev -- --host 127.0.0.1`. Mở URL Vite thông báo (mặc định http://127.0.0.1:5173). Không cần backend/MySQL cho chế độ demo.

Chọn vai trò Guest/User/Staff/Admin ở thanh **DEMO UI**; bấm **Khôi phục mẫu** để đặt lại dữ liệu trong phiên trình duyệt. Xem [hướng dẫn frontend](frontend/README.md) để chọn đúng cú pháp PowerShell hoặc Git Bash.

## Tech Stack

- **Frontend**: React 19, Vite 6, React Router 6, Tailwind CSS 4, Lucide, Axios
- **Backend**: Java 21, Spring Boot 3.5.16, Spring Security, Spring Data JPA/Hibernate và JdbcTemplate, JWT
- **Database**: MySQL 8.x
- **AI & External APIs**: chưa triển khai; Gemini là phương án gốc, provider/mô hình AI và Map còn chờ chọn

## Quy trình làm việc

**VS Code là môi trường duy nhất để viết, chạy và debug cả Java backend lẫn React frontend.** Hai ứng dụng giao tiếp bằng REST API, không cần liên kết VS Code với NetBeans hay IDE khác.

- Mở thư mục gốc KLTN trong VS Code; làm việc với `backend/` và `frontend/` trong cùng cửa sổ.
- Hiện dùng Maven cho backend và npm cho frontend; chưa có Maven Wrapper. Lệnh build/test, biến môi trường và giới hạn runtime tại [quy trình công cụ](docs/architecture/development-workflow.md).
- MySQL Server lưu dữ liệu; DBeaver là công cụ xem dữ liệu tùy chọn, không phải điều kiện để chạy hệ thống.
- Trình duyệt dùng demo/kiểm thử; Git và GitHub quản lý phiên bản.
- Word dùng viết báo cáo, PowerPoint dùng làm slide khi đến giai đoạn tương ứng. Figma và các công cụ cloud chỉ bổ sung khi có nhu cầu cụ thể.

Chi tiết và các điều kiện môi trường còn thiếu: [Quy trình công cụ](docs/architecture/development-workflow.md).

## Project Structure

- `backend/`: Mã nguồn Spring Boot REST API
- `frontend/`: Mã nguồn React.js SPA
- `backend/src/main/resources/db/migration/`: Nguồn migration Flyway duy nhất
- `database/`: Hướng dẫn database và dữ liệu demo; không chứa bản schema chỉnh tay song song
- `docs/`: Tài liệu thiết kế kiến trúc, Use Case, API Specs

## Tài liệu

- [Phạm vi và yêu cầu](docs/requirements/system-scope.md)
- [Actor và use case](docs/requirements/use-cases.md)
- [Kiến trúc tổng thể](docs/architecture/system-architecture.md)
- [Ranh giới module và quyền](docs/architecture/module-boundaries.md)
- [Cấu trúc thư mục](docs/architecture/project-structure.md)
- [Quyết định và vấn đề còn mở](docs/architecture/decisions.md)
- [Sơ đồ component](docs/diagrams/component-diagram.md)
- [Hướng dẫn database](database/README.md)

Quy tắc nguồn tài liệu: decisions.md sở hữu quyết định và vấn đề còn mở; requirements sở hữu yêu cầu/use case; system-architecture/module-boundaries sở hữu kiến trúc và sai lệch; database-design sở hữu mô tả schema; frontend README sở hữu chạy/routing; phase-4-handoff giữ biên bản UI lịch sử. Note baseline 28/09 đã hợp nhất và xóa, không dùng bản note cũ làm nguồn song song. Tài liệu yêu cầu/thiết kế không chứng minh tính năng hoàn thành; trạng thái phải đối chiếu source và phạm vi test.
