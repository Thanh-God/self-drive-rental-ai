# KDrive — Hệ thống cho thuê xe tự lái

KDrive là ứng dụng web quản lý thuê xe tự lái đa chi nhánh, phục vụ khách hàng, nhân viên vận hành và quản trị viên. Hệ thống hỗ trợ tìm xe, kiểm tra lịch và giá, đặt thuê, giao nhận, hồ sơ người thuê và quản lý dữ liệu vận hành.

Đề tài khóa luận: **Hệ thống cho thuê xe tự lái tích hợp AI hỗ trợ lựa chọn phương tiện và lập kế hoạch hành trình cá nhân hóa**.

## Chức năng

| Người sử dụng | Chức năng |
|---|---|
| Khách chưa đăng nhập | Tìm kiếm, lọc và xem thông tin xe; xem đánh giá công khai; đăng ký, đăng nhập. |
| Khách hàng — USER | Quản lý hồ sơ và GPLX; yêu cầu báo giá, tạo và theo dõi đơn thuê; thao tác hủy theo điều kiện của hệ thống; xem hợp đồng/hóa đơn; gửi đánh giá và báo cáo sự cố. |
| Nhân viên — STAFF | Xử lý đơn, xác nhận/từ chối, ghi nhận giao nhận và hoàn tất thuê trong phạm vi chi nhánh được phân công; theo dõi đội xe và hồ sơ sự cố. |
| Quản trị viên — ADMIN | Quản lý tài khoản, phân công chi nhánh, xe, hãng/loại xe, tiện nghi, chi nhánh và tuyến; kiểm duyệt đánh giá; quản lý URL ảnh, thứ tự và thông tin ghi công qua API. |

Backend kiểm tra quyền, chủ sở hữu, chi nhánh, lịch xe và giá trước khi ghi dữ liệu. ADMIN không tự kế thừa quyền giao nhận của STAFF. Tiền thuê tính theo block 24 giờ, đơn vị VND; thời gian lưu UTC và hiển thị theo giờ Việt Nam. Trạng thái xe đang khai thác không thay thế kiểm tra lịch trong báo giá.

Hợp đồng và hóa đơn lưu snapshot theo đơn thuê. Hệ thống không tích hợp thanh toán trực tuyến; hóa đơn không đồng nghĩa với xác nhận đã thanh toán.

### Phạm vi của phiên bản trong repository

- Giao diện nghiệp vụ sử dụng REST API và MySQL; lỗi API được hiển thị để thử lại, không thay bằng dữ liệu demo.
- Backend cung cấp dữ liệu tiện nghi và API ảnh xe. Gallery, giao diện quản lý ảnh và bộ ảnh xe có hồ sơ giấy phép chưa được tích hợp vào giao diện hiện tại; ảnh thiếu vẫn có placeholder.
- Recommendation, itinerary, AI/Map và dashboard chưa có dịch vụ tích hợp tương ứng. Các màn hình chưa có API hiển thị thông báo trong API mode.
- Demo dành riêng cho xem thử giao diện, không đại diện cho giao dịch hay dữ liệu thuê xe thật.

## Công nghệ và kiến trúc

| Thành phần | Công nghệ |
|---|---|
| Frontend | React 19, Vite 6, React Router 6, Tailwind CSS 4, Lucide React, Axios |
| Backend | Java 21, Spring Boot 3.5.16, Spring Security/JWT, Spring Data JPA/Hibernate, JdbcTemplate |
| Database | MySQL 8, Flyway |
| Kiểm thử | JUnit/Spring Boot Test, H2, MySQL cô lập; Node test runner, JSDOM và browser integration |
| Build | Maven Wrapper, npm |

React SPA giao tiếp với Spring Boot modular monolith qua `/api/v1`. Backend sở hữu nghiệp vụ và persistence; frontend hiển thị dữ liệu và thao tác theo quyền. Một MySQL lưu dữ liệu ứng dụng. Flyway là nguồn migration duy nhất, Hibernate kiểm tra schema bằng `validate`.

## Yêu cầu môi trường

- JDK **21**; `JAVA_HOME` trỏ đúng JDK.
- Node.js **22 trở lên** và npm để chạy frontend và các công cụ kiểm thử.
- MySQL 8 đang chạy và database dành riêng cho KDrive. Docker Desktop với Linux engine là một cách cung cấp MySQL.
- Git Bash trên Windows để dùng các script khởi động dưới đây. Maven Wrapper nằm sẵn trong `backend/`.

## Cấu hình

Tạo `backend/.env.local` bằng cấu hình riêng; không đưa file này vào Git. Ví dụ dùng cổng MySQL local 33385; thay port, schema và tài khoản theo môi trường thực tế:

```dotenv
DB_URL=jdbc:mysql://127.0.0.1:33385/kdrive?useSSL=false&connectionTimeZone=UTC
DB_USER=kdrive
DB_PASSWORD=<mat_khau_database>
JWT_SECRET=<bi_mat_ngau_nhien_it_nhat_32_byte>
PORT=8080
FRONTEND_ORIGIN=http://127.0.0.1:5173
SEED_ENABLED=false
```

Thay các giá trị trong dấu `<...>`. JWT secret phải có ít nhất 32 byte; không dùng giá trị mẫu hoặc đặt secret trong biến frontend `VITE_*`.

Script backend đọc file env và ưu tiên biến đã export trong terminal. Spring Boot không tự đọc `.env.local` nếu chạy bằng cách khác. Dùng đúng database/port, không mặc định trỏ vào cổng 3306 của ứng dụng khác.

Flyway áp dụng migration khi backend khởi động. Không sửa migration đã áp dụng, bật `clean` hoặc reset database để xử lý lỗi. Xem [hướng dẫn database](database/README.md).

Với database phát triển mới chưa có tài khoản, có thể bật `SEED_ENABLED=true` và cung cấp `SEED_PASSWORD` ít nhất 12 ký tự để tạo dữ liệu mẫu. Seed bỏ qua khi users đã có dữ liệu, không dùng để reset. Tài khoản mẫu: `admin@example.test`, `user@example.test`, `staff.dn@example.test`, `staff.hn@example.test`; mật khẩu do bạn đặt qua `SEED_PASSWORD`. Dữ liệu seed không phải cấu hình kinh doanh chính thức.

## Chạy giao diện sử dụng API thật

Mở terminal tại **thư mục gốc repository**. Cài dependency frontend một lần:

```bash
cd frontend
npm ci
cd ..
```

Đảm bảo `java -version` báo Java 21, MySQL đã chạy và cấu hình backend đầy đủ. Mở hai terminal Git Bash tại thư mục gốc:

**Terminal 1 — backend**

```bash
bash scripts/run-backend-gitbash.sh
```

**Terminal 2 — frontend**

```bash
bash scripts/run-frontend-gitbash.sh
```

Mở **http://127.0.0.1:5173**. Frontend script bật `VITE_DATA_MODE=api`, dùng `/api/v1` qua proxy tới backend port 8080 và từ chối khởi động khi port 5173 bận. Backend script build bằng Maven Wrapper trước khi chạy JAR. Nếu đổi backend port, đồng bộ Vite proxy và cấu hình origin.

Health: `http://127.0.0.1:8080/api/v1/health`; qua proxy: `http://127.0.0.1:5173/api/v1/health`. Health xác nhận dịch vụ phản hồi, không thay thế kiểm thử nghiệp vụ. Giữ hai terminal mở, dùng Ctrl+C để dừng process tương ứng. Script không tự khởi động, dừng hoặc reset MySQL.

### Xem thử demo giao diện

Trong `frontend/`, dùng PowerShell:

```powershell
$env:VITE_DATA_MODE = "demo"
npm run dev -- --host 127.0.0.1
```

Demo có nhãn **DEMO UI**, dữ liệu mẫu và bộ chọn vai trò. Không nhập thông tin đăng nhập thật trong chế độ này. Chi tiết tại [hướng dẫn frontend](frontend/README.md).

## Kiểm thử và build

Backend, trong `backend/`, dùng JDK 21:

```powershell
./mvnw.cmd verify
```

Git Bash dùng `./mvnw verify`. Kiểm tra MySQL phải chạy trên fixture/schema riêng; H2 hoặc test SKIP không thay thế integration/concurrency MySQL. Xem [runner ảnh và tiện nghi](scripts/coordination/c10-vehicle-media/README.md).

Frontend, trong `frontend/`:

```powershell
npm test
npm run lint
$env:VITE_DATA_MODE = "api"
$env:VITE_API_BASE_URL = "/api/v1"
npm run build
```

Build không thay thế kiểm thử tương tác bằng trình duyệt. Không trỏ test ghi dữ liệu vào MySQL vận hành của người dùng.

## Cấu trúc repository

```text
backend/      Spring Boot REST API, Maven Wrapper và backend tests
frontend/     React SPA, components, API client và frontend tests
database/     Hướng dẫn database
docs/         Yêu cầu, kiến trúc, database, API và UI
scripts/      Khởi động, kiểm chứng và vận hành fixture
skills/       Hướng dẫn thực hiện và bàn giao kiểm thử
```

Migration: `backend/src/main/resources/db/migration/`. `.runtime/`, `target/`, `dist/` và `node_modules/` chứa dữ liệu chạy, build, dependency hoặc evidence local; không phải module nghiệp vụ.

## Tài liệu tham khảo

- [Phạm vi hệ thống](docs/requirements/system-scope.md) và [use case](docs/requirements/use-cases.md).
- [Kiến trúc](docs/architecture/system-architecture.md), [ranh giới module](docs/architecture/module-boundaries.md), [cấu trúc project](docs/architecture/project-structure.md).
- [Quyết định nghiệp vụ](docs/architecture/decisions.md).
- [Database](docs/database/database-design.md) và [API ảnh xe](docs/api/c10b-vehicle-images.md).
- [Frontend](frontend/README.md), [vận hành và phát triển](docs/architecture/development-workflow.md).

Lịch sử kiểm chứng và phạm vi nghiệm thu nằm trong [audit kỹ thuật](docs/architecture/core-audit-20261007.md); README là tài liệu giới thiệu và sử dụng sản phẩm.
