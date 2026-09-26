# Hệ thống cho thuê xe tự lái tích hợp AI hỗ trợ lựa chọn phương tiện và lập kế hoạch hành trình cá nhân hóa

## Trạng thái dự án

Giai đoạn 1 đã xác định phạm vi và use case. Giai đoạn 2 đã thống nhất kiến trúc. Giai đoạn 3 đã duyệt 20 bảng nghiệp vụ cơ sở và các chính sách được ghi tại [thiết kế database](docs/database/database-design.md); chưa có migration hoặc database được kiểm thử. Giai đoạn 4 đã hoàn thành triển khai UI/UX web desktop, routing và luồng dữ liệu demo có nhãn ngày 27/09/2026. Xem [biên bản bàn giao và giới hạn](docs/ui/phase-4-handoff.md). Chưa triển khai nghiệp vụ backend hoặc tích hợp Gemini/Map thật.

## Chạy demo giao diện

Mở terminal tại `E:\AI\BERT_Project\codepython\KLTN\frontend`. Chạy `npm ci` nếu chưa cài thư viện, sau đó `npm run dev -- --host 127.0.0.1`. Mở URL Vite thông báo (mặc định http://127.0.0.1:5173). Không cần backend/MySQL cho chế độ demo.

Chọn vai trò Guest/User/Staff/Admin ở thanh **DEMO UI**; bấm **Khôi phục mẫu** để đặt lại dữ liệu trong phiên trình duyệt. Xem [hướng dẫn frontend](frontend/README.md) để chọn đúng cú pháp PowerShell hoặc Git Bash.

## Tech Stack

- **Frontend**: React 19, Vite 6, React Router 6, Tailwind CSS 4, Lucide, Axios
- **Backend**: Java Spring Boot 3.x, Spring Security, Spring Data JPA, Hibernate, JWT
- **Database**: MySQL 8.x
- **AI & External APIs**: Google Gemini API; Map provider còn chờ chọn

## Quy trình làm việc

**VS Code là môi trường duy nhất để viết, chạy và debug cả Java backend lẫn React frontend.** Hai ứng dụng giao tiếp bằng REST API, không cần liên kết VS Code với NetBeans hay IDE khác.

- Mở thư mục gốc KLTN trong VS Code; làm việc với `backend/` và `frontend/` trong cùng cửa sổ.
- Khi có mã ứng dụng: dùng Maven Wrapper cho backend, npm cho frontend; hướng dẫn lệnh chạy sẽ được bổ sung và kiểm thử ở giai đoạn khởi tạo.
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
