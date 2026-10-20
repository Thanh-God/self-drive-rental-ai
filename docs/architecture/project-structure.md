# Cấu trúc repository

| Thư mục | Vai trò |
|---|---|
| backend/src/main/java | Spring Boot modules, controller/service/repository và security/config |
| backend/src/main/resources | Cấu hình và Flyway migrations |
| backend/src/test | Unit/integration tests và fixture |
| frontend/src/api | HTTP nghiệp vụ |
| frontend/src/hooks, context | Trạng thái dữ liệu và phiên |
| frontend/src/components, layouts, pages, routes | Giao diện và điều hướng |
| frontend/src/utils | Hàm dùng chung và tests frontend |
| frontend/public | Tài nguyên tĩnh, ảnh và thông tin bản quyền |
| database | Hướng dẫn database, không chứa datadir runtime |
| docs | Yêu cầu, API, kiến trúc, database và quy tắc UI |
| scripts | Khởi động, test runners và vận hành fixture |

Backend gồm auth/user/vehicle/branch/booking/operation/contract/invoice/review/location/ai; Staff/Admin là quyền, không phải module dữ liệu riêng. Frontend API và demo có nguồn riêng. Xem [ranh giới module](module-boundaries.md).

MySQL lưu dữ liệu trong datadir/volume; không có file database.db kiểu SQLite. target/dist/node_modules là build/dependencies, .runtime là dữ liệu chạy riêng; không phải module nghiệp vụ và không đưa vào Git. File placeholder rỗng không chứng minh module đã triển khai.
