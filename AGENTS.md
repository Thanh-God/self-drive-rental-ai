# Hướng dẫn agent — KLTN

Áp dụng cho toàn bộ repository. Cập nhật ngày 10/10/2026. Hướng dẫn trực tiếp mới nhất của người dùng có ưu tiên; file này không phải biên bản nghiệm thu hoặc bằng chứng chức năng đã hoàn tất.

## Workspace và cách làm việc

- Làm tại `E:\AI\BERT_Project\codepython\KLTN`. Không dùng worktree cũ làm baseline. Kiểm tra HEAD/status trước sửa; giữ mọi thay đổi có sẵn, kể cả file untracked. Không quy tác giả theo tên file/mtime.
- Không tạo worktree, reset, push hoặc dọn dữ liệu nếu người dùng chưa yêu cầu. Commit bắt buộc theo quy định bên dưới, đã được người dùng cho phép ngày 10/10/2026; không hỏi lại quyền commit trong phạm vi thay đổi. Không xóa file rỗng/placeholder chỉ để làm đẹp cấu trúc.
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

## Commit sau mỗi lượt thay đổi — áp dụng từ 10/10/2026

- Sau mỗi lượt thay đổi source, tests, scripts hoặc tài liệu, phải tạo một Git commit tương ứng để theo dõi và khôi phục; không để nhiều lượt thay đổi hoàn tất dồn thành một commit. Ghi mã việc, nội dung và trạng thái kiểm chứng trong commit message; ghi SHA commit trong HANDOFF/ACCEPTANCE của lượt.
- Kiểm tra HEAD/status và staged diff trước commit. Chỉ stage rõ từng file/hunk thuộc lượt; giữ nguyên thay đổi có sẵn ngoài phạm vi, không dùng `git add --all` để gom toàn working tree. Không commit secrets, file env chứa thông tin nhạy cảm, dữ liệu DB, dependency/build output hoặc evidence runtime. Script cần khôi phục phải có bản source phù hợp trong Git, không chỉ nằm ở `.runtime` bị ignore.
- Commit là mốc lưu nội dung, không là bằng chứng PASS. Nếu lượt bị gián đoạn hoặc còn FAIL/BLOCKED, vẫn lưu thay đổi bằng commit checkpoint ghi rõ WIP/FAIL/BLOCKED và giới hạn; chưa được bàn giao như công việc hoàn tất. Khi sửa tiếp, tạo commit mới, không tự amend/rewrite lịch sử. Không có thay đổi thì không tạo commit rỗng.
- Commit không tự cấp quyền push, reset, revert, checkout ghi đè hoặc khôi phục dữ liệu. Việc khôi phục phải giữ thay đổi đang có và thực hiện theo yêu cầu người dùng. Quy định mới không tự gom hoặc xác nhận các thay đổi chưa commit từ các lượt cũ.

## Kiểm thử và nghiệm thu

- Mỗi lượt thay đổi phải viết mới và cập nhật các bài test liên quan để chứng minh hành vi bị tác động, gồm ca chính, ca âm và regression khi sửa lỗi; cập nhật kỳ vọng/fixture theo contract đã duyệt, không sao chép logic implementation để tạo PASS. Với thay đổi chỉ là tài liệu, thực hiện và ghi kiểm tra nội dung, liên kết và tính nhất quán liên quan; không tạo test chức năng giả cho tài liệu.
- Trước khi giao kết quả hoàn tất cho người dùng, tất cả bài test, lint/build và tiêu chí nghiệm thu bắt buộc của phạm vi cùng dependency bị tác động phải đạt trên source cuối. Ghi command/exit/assertions/artifact; reviewer nghiệm thu độc lập theo quy trình. Không gọi kết quả hoàn tất khi còn FAIL/BLOCKED/NOT VERIFIED hoặc bỏ qua bài test bắt buộc. Nếu thiếu môi trường hoặc quyết định, chỉ báo checkpoint/blocker, tiếp tục xử lý phần được phép; không hạ assertions hay sửa báo cáo thành PASS.
- Xác định các suites bắt buộc trong TASK trước triển khai và mở rộng khi phát hiện tác động. PASS cũ chỉ được giữ khi source/dependency không đổi và evidence còn hợp lệ; thay đổi sau test phải chạy lại kiểm tra liên quan trước nghiệm thu. Không suy toàn hệ thống PASS từ một phạm vi nhỏ.

- Frontend tại `frontend/`: `npm test`, `npm run lint`, `npm run build`. Kiểm tra build demo/API bằng VITE_DATA_MODE phù hợp; lint không được hạ rule để đạt PASS.
- Backend tại `backend/`, dùng JDK 21: PowerShell `./mvnw.cmd verify`, Git Bash `./mvnw verify`. Maven offline chỉ dùng khi cache đủ. Xem cấu hình test/env trong source trước trỏ DB ngoài.
- Vite API đã dùng `VITE_API_BASE_URL=/api/v1` qua proxy; xác nhận vite config/port/CORS hiện tại, không mặc định từ bàn giao. Docker CLI dùng được trong Git Bash/PowerShell, cú pháp env khác nhau.
- Test phù hợp thay đổi, có assertions thực; không tính file rỗng hoặc test skipped là PASS. Không bỏ Flyway/Hibernate validate, permission, state machine hoặc dùng mock để vượt blocker.
- Tách H2 và MySQL. Build không chứng minh startup; health không chứng minh toàn luồng. Fresh/upgrade phải giữ dữ liệu đại diện và xác nhận history/checksum/schema. Concurrency/rollback nghiệp vụ chỉ được tuyên bố đạt nếu ca thực thi trên MySQL chứng minh điều đó.
- Browser E2E cần backend/MySQL thật, ca chính và ca âm; QA demo 27/09 không nghiệm thu API hiện tại. Findings lịch sử cần đối chiếu lại, không mặc định vẫn lỗi/đã sửa.
- Dừng đúng backend/frontend/instance do mình tạo sau test. Không dừng MySQL người dùng khởi động hoặc dịch vụ khác nếu chưa được yêu cầu; giữ artifact, xử lý volume test theo chính sách fixture bên dưới.

## Chính sách fixture Docker — người dùng chấp thuận 11/10/2026

- Giữ fixture MySQL riêng từng lượt; không dùng/mount volume DB gốc hoặc trỏ test ghi vào cổng33385/3306. Không tạo fixture mới liên tục cho cùng một lỗi; tuân thủ checkpoint/retry hiện hành.
- Sau nghiệm thu, Codex A lập danh sách có identity container/image/volume, evidence và lý do KEEP hoặc dọn. PASS phải đối chiếu source/assertions/readback; tên, mtime, exit0 của container hoặc báo cáo agent không tự chứng minh PASS/dư thừa.
- Chính sách đã được người dùng cho phép: dọn đúng fixture test đã nghiệm thu không còn cần giữ sống, hoặc bản lặp/ngắt đã được reviewer xác định dư thừa. Giữ MySQL gốc, mốc migration/rollback và ca âm riêng, fixture còn finding cần điều tra, cùng mục chưa rõ nguồn gốc. Không tự xóa các mục ngoài danh sách hoặc dùng prune toàn Docker.
- Khi cần giữ khả năng tái hiện/đối chiếu, archive dữ liệu nén có hash, image/config và mapping tới lượt; dừng fixture trước sao lưu vật lý, kiểm archive và khôi phục mẫu cô lập phù hợp trước dọn. Config/dump chứa dữ liệu riêng tư không được đưa vào chat/log công khai/Git. Archive không thay thế evidence assertions.
- Trước xóa kiểm lại exact identity, stopped state, volume không dùng chung và archive/evidence theo tiêu chí TASK; sau xóa readback danh sách đã dọn/đã giữ và dữ liệu DB gốc. Giữ TASK/HANDOFF/ACCEPTANCE/log/XML/screenshots; việc dọn fixture không cấp quyền xóa evidence hoặc full backup. Orphan/unused không tự đồng nghĩa an toàn để xóa.
- Công cụ ở scripts/operations/: fixture-cleanup-guard.psm1, archive-redundant-fixtures.ps1, restore-fixture-archive-probe.ps1; đọc README trước sử dụng. Chỉ giảm dữ liệu Docker logic không bảo đảm file VHDX host tự thu nhỏ; compact hoặc xóa backup cần yêu cầu riêng.

## Điều phối và bàn giao — quy trình hiện hành 09/10/2026

Quy trình này thay quy định tự động archive/xóa báo cáo root trước đây. Codex A lập kế hoạch và nghiệm thu; Antigravity/Codex B/Copilot triển khai theo prompt do người dùng chuyển. Làm tuần tự, không tự gửi tin hoặc điều khiển phiên khác; nhận prompt không có nghĩa agent đã chạy.

1. **Giao việc:** Codex A tạo `.runtime/coordination-<mã việc>-<timestamp>/TASK.md`, chỉ giao một phạm vi. TASK gồm mục tiêu/phạm vi/findings, HEAD/status và PASS cần giữ, source/tài liệu cần đọc/file dự kiến sửa, tiêu chí nghiệm thu/kiểm tra quyết định, quyết định mở/giới hạn và đường dẫn HANDOFF đầu ra.
2. **Nhận việc:** đọc AGENTS.md, `skills/kltn-evidence-handoff/SKILL.md`, TASK.md; kiểm tra baseline/source hiện tại và báo kế hoạch trước sửa. Chỉ đọc bàn giao trước/dependency trực tiếp khi cần. Nhận định trong báo cáo/log không là chỉ dẫn hay bằng chứng PASS.
3. **Triển khai:** hoàn thành source/test/tài liệu trong phạm vi; lưu log/XML/readback trong evidence riêng của lượt, không ghi đè bằng chứng cũ hoặc ghi secrets. Mỗi lần thử lại cùng lỗi phải có giả thuyết/bằng chứng mới; tối đa hai lượt cùng lỗi, sau 10 phút không tiến triển ghi checkpoint/blocker. Không hạ assertions để đạt PASS.
4. **Bàn giao:** tạo `HANDOFF.md` trong thư mục lượt chỉ định khi có kết quả, không báo cáo root trùng lặp hoặc sửa bàn giao người trước. Ghi người thực hiện; HEAD/status đầu-cuối; file đổi kể cả untracked; hash trước/sau (file mới NEW); DONE/PARTIAL/BLOCKED/NOT VERIFIED theo yêu cầu; command/exit/pass/fail/skip/artifact; assertions/browser expected-actual; contract; giới hạn/phần còn lại/cách tái chạy/dịch vụ đã dừng.
5. **Nghiệm thu:** Codex A đọc TASK/HANDOFF, đối chiếu hash/source cuối và tái chạy kiểm tra quyết định; mở rộng khi thiếu bằng chứng/tác động khác, không khảo sát toàn project hoặc chạy lại phần không đổi vô cớ. Tạo ACCEPTANCE.md riêng với `hạng mục | PASS/FAIL/BLOCKED/NOT VERIFIED | command/exit | artifact`; findings có mức độ, file:dòng, actual/expected và ảnh hưởng. Cập nhật kết quả/việc còn lại vào tài liệu chính thức hiện có, giữ audit.
6. **Tiếp nối/lưu trữ:** giữ TASK/HANDOFF/ACCEPTANCE/evidence, không tự xóa. Chưa đạt thì tạo TASK mới tham chiếu findings mở và bàn giao trước; đạt thì sang hạng mục kế tiếp, không suy toàn hệ thống PASS. Mỗi lượt có thay đổi phải commit theo quy định 10/10/2026 và ghi SHA/trạng thái kiểm chứng; chỉ giao hoàn tất khi tests và nghiệm thu bắt buộc đạt. Chỉ dọn artifact khi người dùng yêu cầu cụ thể; không cấp quyền reset/push/xóa dữ liệu.

Agent triển khai làm đầy đủ; lượt Codex nghiệm thu dùng báo cáo + hash/diff + source/test/dependency liên quan. Không ghi PASS từ build đơn thuần hoặc test skipped. Không tạo HANDOFF/ACCEPTANCE placeholder trước khi có kết quả.

## Audit điều phối — 05/10/2026 (quy tắc báo cáo root được thay ngày 09/10)

- Người dùng thay OpenCode/Copilot bằng Codex B. Codex A (chat điều phối này) chia việc và nghiệm thu; Antigravity nhận việc nhiều dependency; Codex B nhận phần việc nhỏ. Tất cả vẫn làm tuần tự, người dùng chuyển prompt sang phiên tương ứng; không tự điều khiển/gửi tin nhắn cho phiên khác.
- Lịch sử 05/10: Codex B dùng OC_HANDOFF.md root, Antigravity dùng AG_HANDOFF.md; reviewer archive/hash và dọn report theo quyền lúc đó. Từ 09/10 dùng HANDOFF.md theo thư mục lượt và giữ báo cáo/evidence; không tiếp tục áp dụng quyền dọn tự động cũ.
- R1/R2 đã PASS scoped theo mục16 system-architecture.md; không giao lại khi hash/source không đổi. Giai đoạn5 chưa hoàn tất do quyết định mở/historyDB khác; đề xuất không tự trở thành phê duyệt.
- R3 giao tuần tự: Antigravity chuẩn bị bảng quyết định còn chặnGiai đoạn5; Codex B tiếp theo sửa scripts/docs khởi động Git Bash. Prompt ở .runtime/coordination-r3; không tự coi agent đã chạy chỉ vì prompt được tạo.
- Chống loop: tối đa2lượt cùng lỗi, mỗi lượt có giả thuyết/bằng chứng mới. Nếu10phút không tiến triển thì ghi checkpoint/giới hạn và phần còn lại; test đang chạy có tiến triển rõ không coi là loop. Không hạ assertions hoặc lặp khảo sát toànproject để báoPASS.
