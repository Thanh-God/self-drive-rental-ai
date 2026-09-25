# Cấu trúc thư mục Giai đoạn 2

Các đường dẫn trong tài liệu tính từ thư mục gốc repository. Đây là cấu trúc module đã thống nhất; ứng dụng chưa có mã thực thi, `pom.xml`, `package.json` hoặc migration SQL.

```text
KLTN/
├── backend/
│   └── src/
│       ├── main/
│       │   ├── java/com/carrental/
│       │   │   ├── config/
│       │   │   ├── security/
│       │   │   ├── common/
│       │   │   ├── exception/
│       │   │   ├── modules/
│       │   │   │   ├── auth/
│       │   │   │   ├── user/
│       │   │   │   ├── vehicle/
│       │   │   │   ├── booking/
│       │   │   │   ├── operation/
│       │   │   │   ├── branch/
│       │   │   │   ├── location/
│       │   │   │   ├── contract/
│       │   │   │   ├── invoice/
│       │   │   │   ├── review/
│       │   │   │   └── ai/
│       │   │   │       ├── recommendation/ (controller, dto, service, engine)
│       │   │   │       └── itinerary/ (controller, dto, service, entity, repository)
│       │   │   └── integration/
│       │   │       ├── gemini/dto/
│       │   │       └── map/dto/
│       │   └── resources/db/migration/
│       └── test/java/com/carrental/
├── frontend/
│   ├── public/
│   └── src/
│       ├── api/
│       ├── assets/ (images, icons)
│       ├── components/ (common, vehicle, booking, inspection, ai)
│       ├── context/
│       ├── hooks/
│       ├── layouts/
│       ├── pages/ (guest, shared, user, staff, admin)
│       ├── routes/
│       └── utils/
├── database/README.md
├── docs/
│   ├── requirements/
│   ├── architecture/
│   ├── diagrams/
│   └── api_specs/
└── README.md
```

Các module CRUD hiện dùng `controller`, `dto`, `service`, `entity`, `repository`. `auth` chỉ cần controller/dto/service và dùng tài khoản của `user`. Chỉ thêm tầng khi có trách nhiệm thực tế; không sinh lớp rỗng để đủ mẫu. Test sẽ chia theo module khi có code.

## Đối chiếu scaffold ban đầu

| Vị trí | Thay đổi Giai đoạn 2 | Lý do |
|---|---|---|
| `modules/staff` | Bỏ 5 file `.gitkeep` và các thư mục trống | Tài khoản Staff thuộc user, nghiệp vụ thuộc booking/operation |
| `modules/admin` | Bỏ 3 file `.gitkeep` và các thư mục trống | Quản trị đặt trong module sở hữu dữ liệu |
| `modules/location` | Thêm 5 thư mục tầng với `.gitkeep` | Catalog địa điểm tham quan độc lập |
| `modules/branch` | Giữ | Chi nhánh giao nhận; không gộp với điểm tham quan |
| `modules/operation` | Giữ, giới hạn trách nhiệm | Giao nhận và điều phối; không tự sở hữu trạng thái đơn |
| `modules/ai` | Giữ lowercase và hai chức năng | recommendation/engine tính điểm; itinerary lưu kế hoạch |
| `integration/map` | Giữ | Adapter nhà cung cấp, không giữ catalog nội bộ |
| `frontend/src/pages` | Giữ đủ các khu vực | Pages theo actor giúp điều hướng, không quyết định phân quyền server |
| `frontend/src/context`, `api` | Giữ, mô tả lại trách nhiệm | Context nhỏ; API client tập trung |
| `database/migrations` | Bỏ placeholder và thư mục trống | Tránh nguồn migration thứ hai |
| `docs/architecture` | Thêm tài liệu kiến trúc/quy trình/quyết định | Cơ sở thiết kế chi tiết và báo cáo |

Không có mã nghiệp vụ phải di chuyển ở giai đoạn này. Các file khởi tạo Spring Boot, Vite, Maven Wrapper và cấu hình chạy/debug VS Code chỉ bổ sung ở giai đoạn triển khai sau khi kiểm tra môi trường.
