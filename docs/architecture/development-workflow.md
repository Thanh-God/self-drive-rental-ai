# Quy trình công cụ đơn giản cho KLTN

## Nguyên tắc đã chốt

VS Code là nơi viết/chạy/debug Java và React. Mục tiêu là không phụ thuộc đường dẫn Maven của IDE. Audit 29/09/2026: chưa có Maven Wrapper, máy kiểm tra đang dùng Maven sẵn trong NetBeans qua CLI (không mở IDE); quy trình portable chưa hoàn tất. Chỉ bổ sung công cụ khi có nhu cầu cụ thể.

| Công cụ | Vai trò | Mức cần thiết |
|---|---|---|
| VS Code | Mở repository, sửa Java/React/tài liệu, chạy terminal/debug | Môi trường phát triển thống nhất |
| JDK 21 + Maven | Biên dịch, test và chạy Spring Boot | Wrapper là mục tiêu, hiện chưa có |
| Node.js + npm | Cài dependency, chạy/build React | Bắt buộc khi triển khai frontend |
| MySQL Server | Lưu dữ liệu ứng dụng | Bắt buộc khi chạy nghiệp vụ |
| Trình duyệt | Xem giao diện và demo/kiểm thử | Bắt buộc |
| Git + GitHub | Lịch sử thay đổi và bản sao mã nguồn | Công cụ quản lý phiên bản |
| DBeaver | Xem bảng và truy vấn phục vụ học/debug | Tùy chọn; dùng một GUI database là đủ |
| Word / PowerPoint | Báo cáo / slide bảo vệ | Dùng khi đến giai đoạn tài liệu tương ứng |
| Figma, Canva, Google Drive | Thiết kế hoặc cộng tác khi có yêu cầu | Không là điều kiện chạy/demo |
| Docker, NetBeans, Workbench, SSMS | Không nằm trong quy trình chạy mặc định | Không phải học hoặc mở cùng dự án |

MySQL Workbench có thể thay DBeaver nếu cần, không yêu cầu dùng cả hai. SSMS không dùng thay MySQL. Docker chỉ xem xét nếu có nhu cầu triển khai cụ thể; ưu tiên hướng chạy local trực tiếp để ít tầng vận hành.

## Tình trạng khảo sát máy ngày 25/09/2026

Đây là ghi nhận lịch sử, không dùng để suy ra cấu hình hiện tại. Audit 29/09 dùng JDK 21.0.12.1 và Spring Boot 3.5.16; MySQL executable có trên máy nhưng lượt test mới dùng H2.

- Đã chạy được Git 2.50.1, Java/javac 23, Node 24.11.0, npm 11.6.1 và Python 3.12.0.
- Maven 3.9.9 hiện được tìm thấy bên trong NetBeans; dự án sẽ có Maven Wrapper để không phụ thuộc đường dẫn IDE đó.
- Đã phát hiện VS Code, DBeaver, MySQL Workbench và Microsoft Office. Có ứng dụng không có nghĩa mọi chức năng đã được kiểm thử.
- Chưa xác nhận MySQL Server hoạt động. XAMPP trên máy cung cấp MariaDB 10.4.32; không tự thay stack MySQL đã chốt bằng MariaDB.
- Docker CLI có mặt nhưng không kết nối được engine trong lần khảo sát; Docker không là điều kiện bắt buộc của quy trình này.
- Chưa chốt phiên bản JDK/Spring Boot cho project; phiên bản đang cài không tự động là phiên bản chuẩn. Chọn phiên bản tương thích và ghi cố định khi khởi tạo.

## Cách chạy dự kiến khi ứng dụng đã được khởi tạo

1. Mở một thư mục KLTN trong VS Code, không cần mở NetBeans.
2. Bảo đảm MySQL Server chạy và cấu hình môi trường backend hợp lệ.
3. Chạy backend từ thư mục backend bằng Maven hiện có; backend áp dụng Flyway và kết nối MySQL. Chuyển sang Wrapper khi đã bổ sung.
4. Chạy frontend từ thư mục frontend bằng npm trong terminal thứ hai.
5. Mở URL frontend trong trình duyệt. React gửi REST request đến backend; backend truy cập database và API ngoài.
6. Khi có lỗi, xem terminal backend/frontend tương ứng; mở DBeaver chỉ nếu cần kiểm tra dữ liệu.

Backend đã có code và cấu hình chạy; hướng dẫn bên dưới phân biệt build/test đã chạy với runtime MySQL cần xác minh. Không coi build JAR là đã khởi động ứng dụng production.

## Lệnh hiện có và kết quả audit 29/09

Frontend, tại frontend/: `npm test`, `npx --no-install eslint src`, `npm run build`. Chạy thử UI bằng `npm run dev -- --host 127.0.0.1`. VITE_DATA_MODE=demo mặc định; đặt api để dùng backend thật. Hướng dẫn đầy đủ tại frontend/README.md.

Backend yêu cầu Java 21 và Maven. Tại backend/: `mvn verify` chạy test và tạo Spring Boot JAR trong target. Máy audit dùng lệnh PowerShell sau do mvn chưa ở PATH (đường dẫn này không phải dependency của ứng dụng):

```powershell
$env:JAVA_HOME = 'E:\Tools\Java\jdk-21.0.12.1+1'
& 'C:\Program Files\NetBeans-23\netbeans\java\maven\bin\mvn.cmd' -o -B -ntp '-Dmaven.repo.local=E:/AI/BERT_Project/codepython/KLTN/.runtime/m2' verify
```

`-o` chỉ phù hợp khi dependency đã có trong cache. Trên máy mới dùng Maven được cài hợp lệ và cho tải dependency, không sao chép đường dẫn IDE như yêu cầu bắt buộc.

Runtime theo application.yml: chuẩn bị MySQL database/tài khoản riêng, cấu hình DB_URL, DB_USER, DB_PASSWORD, JWT_SECRET (ít nhất 32 byte); tùy chọn PORT, FRONTEND_ORIGIN, TOKEN_MINUTES. Chạy `java -jar target/kdrive-0.1.0-SNAPSHOT.jar` sau build. Seed chỉ bật rõ ràng với SEED_ENABLED/SEED_PASSWORD ở môi trường thử; xem database/README.md. Đây là hướng dẫn từ cấu hình, chưa phải biên bản khởi động MySQL end-to-end trong phiên audit.

RentalIntegrationTest mặc định H2 in-memory; KDRIVE_TEST_DB_URL/USER/PASSWORD chuyển sang DB ngoài. Chỉ dùng database test riêng vì bài test có seed/ghi dữ liệu, không trỏ vào dữ liệu đang dùng. Chưa có reset fixture để chạy lặp an toàn trên database test đã có dữ liệu.

Kết quả mới nhất và giới hạn kiểm chứng duy trì ở [audit hệ thống](system-architecture.md#7-audit-hiện-trạng-ngày-29092026). Chưa có lint Java riêng, tsc hoặc browser E2E API trong suite hiện có.

## Việc cần làm ở giai đoạn khởi tạo

- Kiểm tra extension Java/React cần thiết trong VS Code và sự tương thích JDK/Spring Boot.
- Chuẩn bị MySQL Server và database dành riêng cho demo; không sử dụng database cá nhân có sẵn.
- Thêm Maven Wrapper, cấu hình backend và frontend cùng lockfile; không cài dependency ở Giai đoạn 2.
- Kiểm thử quy trình trên máy từ trạng thái dừng đến chạy thành công, gồm migration/seed và trường hợp API ngoài thiếu key.
- Ghi lại quy trình demo dễ lặp lại: khởi động dịch vụ, đăng nhập theo actor, chạy nghiệp vụ và hai AI, dừng ứng dụng.

Mã nguồn và migration nằm trong Git; dữ liệu runtime nằm trong MySQL; API key qua môi trường; bản báo cáo/slide là artifact riêng. Không cần đưa mọi dữ liệu vào repository hoặc chuyển qua nhiều ứng dụng để một chức năng hoạt động.
# Vòng điều phối thử R1 — 04/10/2026

Người dùng duyệt Codex làm đầu mối, Antigravity và OpenCode triển khai tuần tự. Baseline nghiệp vụ/nghiệm thu: mục nghiệm thu độc lập 04/10 trong `system-architecture.md`; HEAD lúc giao `3a8596b0543c95c261fce989d357f58c887e1648`, workspace dirty/untracked nên HEAD không đủ quy nguồn. Prompt lưu `.runtime/coordination-r1/`; chưa có kết quả triển khai khi giao nhiệm vụ.

| Mã | Người làm | Phạm vi | Trạng thái lúc giao |
|---|---|---|---|
| R1-AG | Antigravity | F02 current-read/action race, F03 module boundary/test, F04 rollback sau write | PASS phạm vi R1 sau QA AG3 05/10; hai thiếu sót AG2 đã đóng bằng MySQL/H2 thực thi; bàn giao đã có. Xem mục13 system-architecture |
| R1-OC | Copilot thay OpenCode | F01/L06 version tuyến + contract frontend trực tiếp | PASS kiểm chứng 05/10; implementation đã có trước lượt Copilot, chỉ nhận nguồn cuối, không quy tác giả |
| R1-QA | Codex | Kiểm chứng hai bàn giao, cập nhật findings và lưu audit/dọn báo cáo | Hoàn thành kiểm chứng R1; Giai đoạn5 chưa hoàn tất; artifact .runtime/r1-qa-20261005 |
| R2-FE | Antigravity; sửa tiếp chia Copilot/Antigravity | Browser incident history, auth/response race tích hợp | QA05/10 FAIL bàn giao: authResponseRace.test.js rỗng/hash lệch; browser thiếu reassessment và response đảo thứ tự. Xem mục14 system-architecture, prompt02/03 coordination-r2 |
| DECISION | Người dùng | Snapshot/chính sách mở; kiểm kê DB khác | BLOCKED; không tự chốt |

Mỗi báo cáo root AG_HANDOFF.md/OC_HANDOFF.md gồm: mã/phạm vi và DONE/PARTIAL/BLOCKED; baseline HEAD/status + artifact; bảng file/hash trước/sau; actual/expected đã kiểm chứng; command/exit/count và đường dẫn bằng chứng; contract đổi; việc còn lại; PID/port/dịch vụ đã dừng. Không chép log dài, không dùng báo cáo thay assertion. Không cập nhật hàng loạt docs hoặc sửa audit lịch sử. Sau QA, Codex cập nhật trạng thái tại mục này và biên bản hiện có, sao lưu hai báo cáo rồi xóa chỉ bản root theo quy trình AGENTS.


Cập nhật nghiệm thu R2 lần tiếp — 05/10/2026: xem mục15 `system-architecture.md`, artifact `.runtime/r2-final-qa-20261005`.

| Phần việc | Kết quả cuối lượt | Việc tiếp |
|---|---|---|
| R2-OC/Copilot auth integration | PASS5tests mounted; canonical27PASS,lint/API+demo buildPASS | Không làm lại khi source/hash không đổi |
| R2-AG incident browser | FAIL replay fixture note; reassessment và incident race NOT VERIFIED độc lập | Antigravity xử lý R2B-F01/F02/F03; same-document race + latch A delivered sau B; không sửa source để nghiệm thuPASS |
| Giai đoạn5/DECISION | Chưa hoàn tất; DBhistory khác/chính sách mở BLOCKED | Hoàn tất scope và chốt hoặc phê duyệt hoãn trướcGiai đoạn6 |

Hai handoffs được giữ bản sao/hash trong artifact trước dọn root theo AGENTS. Không coi JSON18steps46assertions của agent là PASS nghiệm thu khi replay thất bại. Không lặp fullproject/backend R1 nếu hashes không đổi.

Cập nhật R2B QA05/10/2026: mục16 `system-architecture.md`; `.runtime/r2b-qa-20261005`.

| Phần việc | Trạng thái nghiệm thu | Tiếp theo |
|---|---|---|
| R2-AG incident history/reassessment/race | PASS scoped: replay18steps59assertions,5DBsnapshot checks;R2B-F01/F02/F03 đóng theo bằng chứng QA mới | Không giao làm lại khi source/hash không đổi |
| R2-OC auth integration | Giữ PASSaudit15;hash không đổi | Không lặp27tests/lint/build |
| Giai đoạn5/DECISION | Chưa chốt hoàn tất;policies/DBhistory khácBLOCKED | Người dùng chốt/hoãn phạm vi và quyết định trướcGiai đoạn6;kiểm kê DB trướcdeployment |

AG_HANDOFF lưu bản sao/hash rồi dọn root;OCrootkhôngtồn tại. Giữ audit15FAIL để truy nguyên,không thay bằngPASS lịch sử.
