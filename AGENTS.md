# Hướng dẫn agent — KLTN

Áp dụng cho toàn bộ repository. Cập nhật ngày 04/10/2026. Hướng dẫn trực tiếp mới nhất của người dùng có ưu tiên; file này không phải biên bản nghiệm thu hoặc bằng chứng chức năng đã hoàn tất.

## Workspace và cách làm việc

- Làm tại `E:\AI\BERT_Project\codepython\KLTN`. Không dùng worktree cũ làm baseline. Kiểm tra HEAD/status trước sửa; giữ mọi thay đổi có sẵn, kể cả file untracked. Không quy tác giả theo tên file/mtime.
- Không tạo worktree, reset, commit, push hoặc dọn dữ liệu nếu người dùng chưa yêu cầu. Không xóa file rỗng/placeholder chỉ để làm đẹp cấu trúc.
- Antigravity, Copilot, OpenCode và Codex làm tuần tự. Không sửa cùng file/chạy dịch vụ song song; kiểm tra process/port trước khởi động. Không tự giao việc cho chat/agent khác.
- Báo kế hoạch cụ thể và file dự kiến sửa trước triển khai, rồi tự hoàn thành phần được phép. Chỉ hỏi khi thiếu quyết định thiết kế/nghiệp vụ hoặc có nguy cơ mất dữ liệu; không hỏi lại quyền đã được cấp.
- Dùng `rg` và đọc phần liên quan. Không mở rộng phạm vi sang redesign, AI/Map, payment hoặc refactor toàn backend khi nhiệm vụ chỉ là sửa/kiểm thử một luồng.

## Nguồn cần đọc theo nhiệm vụ

- `docs/architecture/decisions.md`: quyết định đã duyệt và câu hỏi còn mở.
- `docs/requirements/system-scope.md`, `use-cases.md`: yêu cầu nghiệp vụ.
- `docs/architecture/system-architecture.md`: kiến trúc và audit lịch sử N01–N07/L01–L12.
- `docs/architecture/module-boundaries.md`, `project-structure.md`, `development-workflow.md`: ranh giới, cấu trúc, vận hành.
- `docs/database/database-design.md`, `database/README.md`: thiết kế DB và hướng dẫn migration.
- `frontend/README.md`, `docs/ui/phase-4-handoff.md`: frontend và QA demo/API.
- Nếu có, đọc `AG_PHASE5_RESULT.md`, `COPILOT_PHASE5_RESULT.md`, `OPENCODE_PHASE5_RESULT.md` khi tiếp nối. Đối chiếu source/hash/artifact; báo cáo agent không tự chứng minh PASS. Tài liệu cũ có thể chưa phản ánh source mới.

## Kiến trúc và cấu trúc

- React/Vite SPA + Spring Boot modular monolith + một MySQL; Java 21, Maven Wrapper, JPA/Hibernate, Security/JWT. Không microservices hoặc thanh toán online.
- Backend có thẩm quyền về giá, lịch, quyền và trạng thái. Controller nhận/trả HTTP; service giữ nghiệp vụ; repository/adapter giữ persistence. Giao tiếp module qua API nội bộ/DTO có kiểu; tránh SQL và entity mutable xuyên module.
- Module: auth, user, vehicle, branch, booking, operation, contract, invoice, review, location và ai. Staff/Admin là role, không tạo module dữ liệu riêng. `common` chỉ dành cho tiện ích thực sự dùng chung.
- Frontend: `api` tập trung HTTP nghiệp vụ; `hooks`, `context`, `components`, `layouts`, `routes`, `utils` có trách nhiệm riêng. Pages hướng tới guest/shared/user/staff/admin; `pages/api` hiện là tổ chức tích hợp cần cải thiện trong phạm vi được giao, không tự di chuyển hàng loạt.
- Demo và API có nguồn dữ liệu riêng; lỗi API không được thay bằng mock/demo. Không gọi AI/Map secret từ frontend.
- `database/` chứa hướng dẫn, không chứa file DB runtime. MySQL lưu dữ liệu trong datadir/volume; không kỳ vọng file `.db` như SQLite. `target`, `dist`, `node_modules`, `.runtime` là build/dependency/artifact, không phải module nghiệp vụ.

## Database và môi trường

- Nguồn Flyway duy nhất: `backend/src/main/resources/db/migration/`. Không thêm schema.sql/DDL chỉnh tay song song. Giữ Hibernate `validate`, Flyway validation, `clean-disabled=true`, `baseline-on-migrate=false`.
- Không sửa migration đã áp dụng trong môi trường dùng chung. Trước nâng cấp phải kiểm kê history/checksum/schema; MySQL DDL có thể tồn tại một phần sau lỗi. Không tự clean/repair/reset hoặc giả định rollback nguyên migration.
- Người dùng chốt 04/10: review liên kết xe qua booking; không thêm `reviews.vehicle_id` trực tiếp. V2 workspace đã được sửa trước phát hành để giữ phần audit sự cố. Lịch sử các DB khác chưa rõ: chỉ dùng bản sửa với DB mới hoặc V1 chưa thử V2; môi trường đã thử/áp dụng V2 cần kế hoạch riêng có phê duyệt phù hợp.
- V1 baseline: 25 bảng nghiệp vụ, 37 FK; cộng Flyway history là 26 bảng. Giới hạn thiết kế 30 bảng, không thêm bảng AI dự phòng. Tính lại schema/hash khi nghiệm thu; không ép kết quả mới khớp tuyên bố lịch sử.
- MySQL local KLTN đã dùng: container `kltn-phase5-rerun`, host `127.0.0.1`, port `33385`, schema/user `kdrive`, volume `kltn_phase5_rerun_20261004_1823`. Đây là thông tin phiên local, không bảo đảm dịch vụ luôn chạy hoặc cấu hình production.
- Không dùng/sửa container `quiz_mysql` ở cổng 3306 cho KLTN. `application.yml` mặc định 3306, nên phải nạp đúng `DB_URL` trước chạy.
- Secrets lượt local ở `.runtime/phase5-rerun-20261004-1823/backend.env` và `mysql.env` nếu còn tồn tại; không in secrets vào chat/log/bàn giao hoặc commit. `backend/.env.local` được Git bỏ qua nhưng Spring Boot không tự đọc file env: nạp biến môi trường theo shell đang dùng.
- Seed opt-in qua `SEED_ENABLED`/`SEED_PASSWORD`, không reset dữ liệu hiện có. Phí/tài khoản seed chỉ là mẫu. Test ghi dữ liệu/concurrency/migration dùng schema hoặc instance riêng; không mặc định tái dùng DB browser có dữ liệu.
- Artifact trước ở `.runtime/audit-acceptance-20260929`, `.runtime/phase5-20261004`, `.runtime/phase5-rerun-20261004-1823`. Giữ nguyên, tạo thư mục riêng cho lượt mới.

## Nghiệp vụ không được tự đổi

- Guest không là role; USER/STAFF/ADMIN. Admin không kế thừa giao/nhận Staff; backend kiểm tra quyền, chi nhánh và chủ sở hữu.
- Branch là điểm vận hành, location là tham quan. Nhận/trả theo tuyến mở; phân biệt home/current/pickup/return/actual_return branch. Không giả xe tự về, tự điều chuyển hoặc tự đổi điểm trả giữa chuyến.
- Staff xác nhận/giao ở chi nhánh nhận, nhận trả/hoàn tất ở chi nhánh trả. Quyền đọc đơn cũ không tự cấp quyền tác động xe ở chi nhánh hiện tại.
- Thuê làm tròn block 24 giờ; VND nguyên đồng; lưu UTC, hiển thị Asia/Ho_Chi_Minh. PENDING giữ tối đa 2 giờ không vượt giờ nhận; tuân thủ state machine đã duyệt.
- GPLX xét scheme VN_PRE_2025/VN_2025, số chỗ, hộp số và hiệu lực đến hết thuê; không so thứ bậc tên hạng. Staff đối chiếu trước giao; không thêm ảnh/tra cứu quốc gia chưa duyệt.
- Sự cố có vòng đời riêng; occurred_at khác reported_at. Cho báo muộn nhưng thời điểm xảy ra phải thuộc thời gian giữ xe thực tế. Giữ audit/căn cứ, tách thiệt hại, chi trả bên khác và yêu cầu bồi thường; không tự trừ cọc.
- Hợp đồng lúc xác nhận, hóa đơn lúc hoàn tất, giữ snapshot; hóa đơn không chứng minh thanh toán. Checkbox quote không phải ký hợp đồng.
- Cọc, phụ phí, đệm lịch, no-show, gia hạn/trả muộn, phát hành lại, phạm vi snapshot, retention/delete, quyền AI Guest, Map/AI provider còn mở theo decisions.md. Không tự chốt. AI sau core đạt kiểm thử; không lưu itinerary thiếu tuyến kiểm chứng.

## Kiểm thử và nghiệm thu

- Frontend tại `frontend/`: `npm test`, `npm run lint`, `npm run build`. Kiểm tra build demo/API bằng VITE_DATA_MODE phù hợp; lint không được hạ rule để đạt PASS.
- Backend tại `backend/`, dùng JDK 21: PowerShell `./mvnw.cmd verify`, Git Bash `./mvnw verify`. Maven offline chỉ dùng khi cache đủ. Xem cấu hình test/env trong source trước trỏ DB ngoài.
- Vite API đã dùng `VITE_API_BASE_URL=/api/v1` qua proxy; xác nhận vite config/port/CORS hiện tại, không mặc định từ bàn giao. Docker CLI dùng được trong Git Bash/PowerShell, cú pháp env khác nhau.
- Test phù hợp thay đổi, có assertions thực; không tính file rỗng hoặc test skipped là PASS. Không bỏ Flyway/Hibernate validate, permission, state machine hoặc dùng mock để vượt blocker.
- Tách H2 và MySQL. Build không chứng minh startup; health không chứng minh toàn luồng. Fresh/upgrade phải giữ dữ liệu đại diện và xác nhận history/checksum/schema. Concurrency/rollback nghiệp vụ chỉ được tuyên bố đạt nếu ca thực thi trên MySQL chứng minh điều đó.
- Browser E2E cần backend/MySQL thật, ca chính và ca âm; QA demo 27/09 không nghiệm thu API hiện tại. Findings lịch sử cần đối chiếu lại, không mặc định vẫn lỗi/đã sửa.
- Dừng đúng backend/frontend/instance do mình tạo sau test. Không dừng MySQL người dùng khởi động hoặc dịch vụ khác nếu chưa được yêu cầu; giữ volume/artifact.

## Bàn giao và tối ưu lượt Codex

- Mô hình điều phối được người dùng duyệt: Codex chia việc và nghiệm thu; Antigravity nhận việc nhiều dependency; OpenCode nhận từng việc ngắn. Làm tuần tự, không tự coi việc nhận prompt là đã chạy agent. Người dùng chuyển prompt sang các công cụ đó; Codex không có quyền điều khiển phiên bên ngoài chỉ từ tên agent.
- Từ vòng thử R1 dùng `AG_HANDOFF.md`, `OC_HANDOFF.md` tại root. Người sau đọc báo cáo người trước nhưng kiểm tra source cuối; không sửa báo cáo người trước. Chỉ tạo báo cáo khi có kết quả, không tạo placeholder. Báo cáo gọn, log/source dài giữ trong artifact mới `.runtime`, không giới hạn chất lượng triển khai để tiết kiệm token Codex.
- Khi người dùng yêu cầu nghiệm thu theo mô hình này, Codex được lưu bản sao báo cáo, chuyển kết quả/findings vào tài liệu chính thức rồi xóa đúng hai báo cáo root; không xóa prompt, AGENTS.md, artifact hoặc báo cáo khác. Không cần PASS mới dọn.
- Bàn giao bắt buộc có HEAD/status đầu-cuối, danh sách file kể cả untracked, hash trước/sau (file mới ghi NEW), hợp đồng API thay đổi, assertions/command/exit/pass/fail/skip, artifact, blockers và PID/port đã dừng. Không ghi PASS nếu chỉ build hoặc skipped. Dùng đường dẫn + mã finding để tránh kể lại toàn dự án.

- Agent triển khai làm đầy đủ; chỉ lượt Codex nghiệm thu tối ưu token bằng báo cáo + hash/diff + source/test/dependency liên quan. Không quét lại toàn project từ đầu; mở rộng khi thiếu bằng chứng, hash lệch hoặc có tác động ngoài phạm vi.
- Báo cáo tạm theo người thực hiện: `AG_PHASE5_RESULT.md`, `COPILOT_PHASE5_RESULT.md`, `OPENCODE_PHASE5_RESULT.md`. Chỉ tạo/cập nhật file tương ứng khi nhiệm vụ yêu cầu; không tạo thêm báo cáo trùng hoặc sửa báo cáo của agent trước.
- Báo cáo cần: baseline/status; file đổi và SHA256 cuối; DONE/PARTIAL/BLOCKED/NOT VERIFIED; command/môi trường/exit/pass/fail/skip; assertions/browser expected-actual; artifact; contract; quyết định và blocker; cách tái chạy; trạng thái dịch vụ. Không ghi secrets, không báo PASS dự kiến.
- Cập nhật tài liệu chính thức hiện có trong phạm vi; giữ audit lịch sử. Codex nghiệm thu phải kiểm tra source cuối và tái chạy kiểm tra quyết định, không chỉ tin báo cáo.
- Khi người dùng yêu cầu dọn báo cáo: trước hết lưu bản sao vào artifact .runtime và chuyển findings/việc còn lại/bằng chứng cần giữ vào tài liệu chính thức, rồi xóa đúng các file tạm được phép. Không tự xóa AGENTS.md hoặc file khác; lần tạo AGENTS.md này không bao gồm dọn báo cáo.
