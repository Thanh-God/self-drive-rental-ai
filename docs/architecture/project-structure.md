# Cấu trúc thư mục: mục tiêu và hiện trạng

Audit 29/09/2026: đường dẫn tính từ repository. Đã có backend/pom.xml, frontend/package.json, code thực thi và V1__rental_schema.sql. Cây dưới là cấu trúc module mục tiêu ban đầu; thư mục giữ chỗ không được tính là module đã triển khai.

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

Quy ước module CRUD: controller/dto/service/entity/repository; auth dùng tài khoản của user. Source hiện dùng nested record ở controller/service, 7 entity/repository; contract/invoice/review dùng JdbcTemplate trực tiếp trong service. Đây là hiện trạng cần đối chiếu quy tắc phân tầng, không sinh lớp rỗng để đủ mẫu.

## File/thư mục thực thi hiện có

```text
backend/
  pom.xml                         # Java 21, Spring Boot 3.5.16
  src/main/java/com/carrental/
    KDriveApplication.java
    config/ security/ exception/
    modules/
      auth/ user/ branch/ vehicle/ booking/ operation/ contract/ invoice/ review/
  src/main/resources/application.yml
  src/main/resources/db/migration/V1__rental_schema.sql
  src/test/java/com/carrental/{PolicyTest,RentalIntegrationTest}.java
frontend/
  package.json package-lock.json eslint.config.js
  src/
    api/ context/ demo/ routes/ layouts/ components/ hooks/ utils/
    pages/{guest,shared,user,staff,admin}/  # chủ yếu UI demo và auth
    pages/api/{ApiScreens,ApiManagementScreens}.jsx
docs/{requirements,architecture,database,diagrams,ui}/
database/README.md
```

44 Java main files, 2 Java test files ở lượt audit. location/ai/integration chỉ giữ chỗ, chưa có Java triển khai. Chưa có Maven Wrapper. Frontend test hiện ở src/demo/model.test.js, chưa có test tự động cho màn hình API. Node_modules, target, dist, .runtime là dependency/build/cache, không thuộc kiến trúc source.

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

Bảng đối chiếu trên ghi thay đổi lịch sử của Giai đoạn 2. Spring Boot/Vite đã được khởi tạo sau đó; Wrapper và quy trình debug portable còn thiếu. Sai lệch hiện tại theo audit trong system-architecture.md.
