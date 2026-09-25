# Component diagram — kiến trúc logic

Sơ đồ text dùng trong repository, có thể chuyển sang hình cho Chương II khi chuẩn bị báo cáo. Các khối bên trong Spring Boot là module trong cùng ứng dụng, không phải microservice.

```text
  Guest       User       Staff       Admin
    \           |          |           /
     +----------+----------+----------+
                        |
                        v
             React SPA trong trình duyệt
             Pages / Components / Hooks
                  Context / API client
                        |
                  REST / HTTPS + JWT
                        |
                        v
  +---------------- Spring Boot REST API ----------------+
  | Security: xác thực, role; Service: quyền tài nguyên   |
  |                         |                            |
  |                    Controllers                       |
  |                         |                            |
  |              Services và điều phối nghiệp vụ         |
  |                                                      |
  | auth / user         vehicle / branch / location      |
  | booking             operation / contract / invoice   |
  | review              ai/recommendation / ai/itinerary  |
  |                                                      |
  | Repository / JPA       Adapter Gemini / Adapter Map   |
  +----------+---------------------+-------------+--------+
             |                     |             |
             v                     v             v
           MySQL               Gemini API      Map API
```

## Ý nghĩa đường nối và giới hạn

- Trình duyệt chỉ gọi backend cho nghiệp vụ/tích hợp; không giữ API key của Gemini/Map.
- Service truy cập repository của module mình. Giao tiếp module qua service/DTO theo [ranh giới module](../architecture/module-boundaries.md).
- Chỉ repository/backend truy cập MySQL; không có đường Gemini → database.
- Recommendation dùng dữ liệu từ vehicle/booking và Gemini hỗ trợ phân tích/giải thích. Itinerary dùng location, Map ước tính tuyến, Gemini lập lịch rồi backend validate.
- JWT chỉ áp dụng request xác thực; endpoint công khai vẫn qua kiểm tra input và chính sách của backend.
- Flyway trong backend quản lý lịch sử schema MySQL. IDE, DBeaver, GitHub, Word không là component runtime của ứng dụng.

## Sơ đồ phát triển local

```text
Một cửa sổ VS Code mở KLTN
    |-- tiến trình Java/Spring Boot -- MySQL Server
    |-- tiến trình Node/Vite
    `-- mã nguồn, migration và tài liệu trong Git

Trình duyệt --> frontend --> REST API backend
```

Không có đường “NetBeans liên kết VS Code”. Hai phần ứng dụng giao tiếp qua API độc lập với công cụ soạn thảo. Khi triển khai chính thức, cách phục vụ frontend sẽ được ghi trong hướng dẫn triển khai; Vite ở đây là môi trường phát triển.
