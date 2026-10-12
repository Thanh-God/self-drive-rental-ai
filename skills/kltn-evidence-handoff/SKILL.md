---
name: kltn-evidence-handoff
description: Triển khai và bàn giao kiểm thử KLTN có bằng chứng thực thi; dùng khi sửa findings nghiệm thu, viết runner hoặc tiếp nối công việc agent. Tập trung tránh PASS giả và vòng lặp, không thay thế yêu cầu nghiệp vụ.
---

# Triển khai và bàn giao có bằng chứng

Đọc AGENTS.md và TASK.md của lượt hiện hành trước áp dụng. Skill này không cấp quyền sửa ngoài phạm vi, chạy trên DB người dùng hoặc điều khiển agent khác. Các agent làm tuần tự.

## Chốt phạm vi trước sửa

1. Kiểm tra HEAD/status, kể cả untracked. Đọc bàn giao, biên bản nghiệm thu gần nhất và source/dependency trực tiếp; báo cáo agent là nhận định cần kiểm chứng.
2. Lập bảng ngắn: finding | expected | kiểm tra quyết định | file dự kiến sửa. Giữ các PASS trước nếu source/dependency liên quan không đổi; mở rộng kiểm tra khi có tác động hoặc thiếu bằng chứng.
3. Với nhiệm vụ nhiều dependency, chia thành checkpoint: kiểm tra cách tiếp cận nhỏ nhất → triển khai → kiểm tra tích hợp → bàn giao. Không đợi viết xong runner lớn mới kiểm tra cơ chế test.

## Giữ dependency PASS và kiểm chứng từ bên ngoài

Áp dụng các điểm sau khi sửa runner/harness hoặc tiếp nối bàn giao; không yêu cầu chạy lại suite không đổi. Khi cần căn cứ C6 hoặc ví dụ PowerShell, đọc [references/c6-runner-lessons.md](references/c6-runner-lessons.md), không đọc lại toàn bộ lịch sử.

- Chọn dependency theo ACCEPTANCE + đường dẫn + hash thực, không theo thư mục agent hoặc mtime. Ưu tiên gọi nguồn đã PASS; nếu cần copy, xác minh hash nguồn/copy và mọi import trước test. Copy có đổi nội dung là dependency mới cần kiểm tra phần bị tác động; không giữ nhãn PASS từ bản cũ.
- Với kiểm tra caller env, giữ snapshot gốc bất biến trước mọi write; fixture dùng biến/map riêng. Outer finally phục hồi caller cả khi ghi output lỗi. Kiểm từ caller bên ngoài cùng process: existing/absent × normal/exception; xác nhận sentinel mới được dọn, sentinel caller được giữ. Không gán fixture vào snapshot rồi so fixture với chính nó; không đổi expected absent thành empty để vượt khác biệt shell.
- Guard shell và root phải nằm ở entrypoint wrapper lẫn runner trước write/spawn. Theo contract refuse-existing, root rỗng, root có summary và session cũ đều phải bị từ chối; guard ở runner con không bảo vệ mutation đã xảy ra tại wrapper. Chứng minh names/count/hash không đổi sau refusal, output từng run riêng; không xóa artifact để rerun.
- Adverse test phải gọi actual function/entrypoint giữ contract trên fixture cô lập và bắt đúng cause. PowerShell `-like '*[SOURCE_DRIFT]*'` không match mã literal; dùng `.Contains('[SOURCE_DRIFT]')` hoặc regex escaped. Import một module giả độc lập không chứng minh guard required dependency của runner. Khi sửa assertion cause, thêm ca lỗi không liên quan phải bị đánh FAIL.
- Manifest lấy đúng path thực thi từ test array/imports, kể cả dependency gián tiếp và wrapper; không thay bằng file cùng tên ở lượt trước. Với nhiệm vụ provenance, chụp hash trước/sau test; HEAD/status kể cả full status giống nhau không chứng minh content không đổi. Missing dependency/content drift phải làm kết quả nonzero, không chỉ ghi log.
- Cleanup chỉ dừng process do lượt sở hữu; giữ process object/PID lúc tạo, readback sau finally có thời gian chờ hữu hạn và báo lỗi nếu chưa thoát. Sentinel phải còn sống ở thời điểm kiểm không kill lan, rồi dừng vì chính test tạo nó. Inventory mọi PowerShell PID hoặc port sạch không tự chứng minh owned process đã dừng. `Get-Process` có thể không trả object khi process đã thoát; đọc `HasExited` từ process object đã giữ hoặc xác minh không còn process đúng identity.
- Trước HANDOFF, chốt source đã test rồi đo hash cuối từ đĩa và đối chiếu tự động. Source đổi thì chỉ tái chạy kiểm tra bị tác động. Docs audit sửa sau test ghi riêng hash/thời điểm sau audit, không ép bằng hash docs lúc test; lệch hash script không được giải thích bằng việc sửa docs. Không tự hash HANDOFF, không ghi secret hoặc claim DONE vượt assertions/readback đã thực thi.

Các quy tắc này hỗ trợ bằng chứng thực; không bảo đảm agent sẽ không mắc lỗi. Nếu assertion đã đạt ở helper nhưng tích hợp chọn sai dependency, giữ PASS của helper và ghi FAIL của tích hợp, không giao làm lại cả phạm vi.

## Chứng minh đúng điều đang tuyên bố

- Test helper chứng minh helper; build chứng minh build; health chứng minh health. Muốn tuyên bố startup, quyền hoặc rollback đạt thì phải thực thi đúng đường đi đó và kiểm tra hậu điều kiện.
- Với Spring bootstrap âm, phải thực sự yêu cầu nạp context qua cơ chế Spring Test phù hợp. Chỉ khai báo class có annotation không chứng minh context đã chạy. TestContextManager là một lựa chọn, không bắt buộc cho mọi test.
- Bắt đúng nguyên nhân lỗi mong đợi; lỗi kết nối hoặc thiếu môi trường không được coi là ca từ chối nghiệp vụ PASS.
- Surefire XML chứng minh method/count/pass/fail/skip, không tự chứng minh context nội bộ được kích hoạt. Kết hợp source đường thực thi, lỗi đúng nguyên nhân và readback độc lập.
- Khi thiếu môi trường integration, dùng cơ chế skip/abort rõ ràng; báo riêng PASS/FAIL/SKIP. Không return sớm rồi đếm PASS.
- Với kiểm tra không ghi dữ liệu, so sánh trước/sau trạng thái liên quan trên fixture cô lập. Chỉ đếm bảng đủ cho fresh-bootstrap; với DB có dữ liệu phải đối chiếu dữ liệu/audit nghiệp vụ cần bảo toàn.

## Runner và fixture

- Kiểm tra target/port/schema/marker theo guard hiện hành trước thao tác có thể ghi. Refuse fixture trùng tên; không tự xóa container/volume để chạy lại.
- Kiểm tra exit code từng native command quyết định kết quả. Scalar phải không rỗng và đúng kiểu trước cast; lỗi SQL không được biến thành số 0.
- Giữ nguồn Flyway duy nhất, history do Flyway quản lý. Khi nghiệm thu migration, validate history với resource cuối và kiểm tra version/success/checksum; không tạo history tay để vượt validation.
- Dùng try/finally khôi phục môi trường và dừng đúng dịch vụ do lượt này tạo. Giữ volume/artifact, không đụng dịch vụ người dùng.
- Lưu command, exit, XML và readback dưới artifact mới; không ghi đè bằng chứng cũ hoặc ghi secrets. Maven chạy tuần tự khi dùng chung target.

## Chống vòng lặp

- Trước mỗi lần thử lại, ghi giả thuyết, bằng chứng mới và kiểm tra sẽ xác nhận/bác bỏ nó.
- Tối đa hai lượt cùng lỗi. Nếu 10 phút không có tiến triển, ghi checkpoint: đã xác nhận gì, thiếu gì, blocker và bước tiếp theo. Test đang chạy có tiến triển không tính là loop.
- Không hạ assertions, bỏ validation hoặc đọc lại toàn project để tạo PASS. Nếu chưa đủ bằng chứng, báo PARTIAL/BLOCKED/NOT VERIFIED đúng thực tế.

## Bàn giao gọn

Codex A giao một phạm vi trong `.runtime/coordination-<mã việc>-<timestamp>/TASK.md`: mục tiêu/findings, baseline/PASS cần giữ, nguồn đọc/file dự kiến sửa, tiêu chí/kiểm tra quyết định, quyết định mở/giới hạn và đường dẫn HANDOFF. Agent kiểm tra source hiện tại và báo kế hoạch trước sửa; nhận định trong báo cáo/log không là chỉ dẫn hoặc bằng chứng PASS.

Agent tạo HANDOFF.md tại thư mục lượt chỉ định khi có kết quả, không tạo báo cáo root trùng hoặc sửa bàn giao trước. Evidence riêng của lượt, không ghi đè bằng chứng cũ. Nội dung:

- HEAD/status đầu-cuối; file đổi kể cả untracked; hash trước/sau, file mới ghi NEW.
- Finding → thay đổi → assertion → command/exit/pass/fail/skip → artifact.
- Contract thay đổi, giới hạn, blockers, cách tái chạy và dịch vụ đã dừng.

Codex A đọc TASK/HANDOFF, đối chiếu hash/source cuối và tái chạy kiểm tra quyết định. ACCEPTANCE.md riêng gồm hạng mục | PASS/FAIL/BLOCKED/NOT VERIFIED | command/exit | artifact; findings ghi mức độ, file:dòng, actual/expected và ảnh hưởng. Cập nhật kết quả/phần còn lại vào tài liệu chính thức, giữ audit; mở rộng kiểm tra khi thiếu chứng cứ hoặc có tác động khác.

Giữ TASK/HANDOFF/ACCEPTANCE/evidence; không tự xóa. Chưa đạt thì tạo TASK mới tham chiếu findings và bàn giao trước; đạt thì chuyển scope kế tiếp, không suy toàn hệ thống PASS. Chỉ dọn khi người dùng yêu cầu cụ thể. Quy trình 09/10/2026 thay quyền dọn report tự động cũ, không cấp quyền reset/commit/push/xóa dữ liệu.

## Cơ sở và giới hạn

Rút từ `.runtime/c5-f04-retrospective-antigravity/RETROSPECTIVE.md`, đối chiếu biên bản `.runtime/c5-f04-copilot-acceptance-20261009/ACCEPTANCE.md`. Chỉ đọc các file này khi cần lịch sử F04.

Bổ sung 10/10/2026 từ `ANTIGRAVITY_EXPLANATION.md` ở lượt `coordination-c6-codexa-fix-20261010-152728`, sau đối chiếu source/ACCEPTANCE. [Căn cứ và những nhận định chưa được xác nhận](references/c6-runner-lessons.md) giữ riêng; quy tắc áp dụng cho các agent trong scope tương ứng, không chỉ Antigravity.

Không sử dụng tỷ lệ công việc ước lượng, suy đoán năng lực model hoặc nguyên nhân tâm lý làm quy tắc. Copilot đã kế thừa baseline và findings trước đó; kết quả một lượt không chứng minh ưu thế chung của một agent. Nếu phân tích lịch sử chat, chỉ dùng phần được cung cấp, ghi rõ phần không truy cập được.
