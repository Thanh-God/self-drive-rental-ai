# C11-A2 — booking/branch race trên MySQL

Chạy tại root repository Windows với JDK21, Python312, Docker mysql:8.4, Maven cache `.runtime/m2`. Kiểm tra cấu hình và điều kiện môi trường trước khi chạy; không trỏ test ghi DB33385/3306.

1. Tại `backend/`, đặt JAVA_HOME=`E:\Tools\Java\jdk-21.0.12.1+1`, chạy `./mvnw.cmd -o -B -ntp -Dmaven.repo.local=E:/AI/BERT_Project/codepython/KLTN/.runtime/m2 verify` trên source cuối, không nạp biến DB gốc.
2. Tại root: `E:/MT_Python/python312/python.exe -X utf8 scripts/coordination/c11-branch-booking/test_guards.py`.
3. `E:/MT_Python/python312/python.exe -X utf8 scripts/coordination/c11-branch-booking/run-mysql.py --evidence .runtime/<new-run>/mysql`.

Runner dựa trên source A1, dùng fixture riêng33673 với marker trước Spring/Flyway; output mới trong `.runtime`, refuse existing/outside/occupied port/identity. Chạy `BranchClosureBookingTest`6ca và `BranchStatusHttpServerTest`4ca trên cùng fixture. XML phải đúng methods,0failure/error/skip; log phải có đúng2readback lock-wait thật. MySQL root của fixture cần đọc `performance_schema.data_lock_waits/data_locks`; thiếu quyền/môi trường là blocker, không thay bằng delay để đếm PASS.

Ca HTTP dùng actual random-port server; race gọi actual transactional services, outer transaction/latch giữ commit và readback DB chứng minh đang chờ khóa. Clock chỉ thay trong test, không đổi production clock hoặc chỉnh thời điểm DB gốc. H2 bỏ qua2race với assumption rõ; H2 không nghiệm thu race. Giới hạn race được kiểm: close thắng và create thắng trên return branch; HTTP âm kiểm riêng pickup/return, cùng helper khóa ordered distinct IDs. Không tuyên bố đã kiểm mọi biến thể tải cao.

JAR classes/resources phải khớp compiled tree dùng tests; backend/runner source before/after không drift. Credentials chỉ ở runtime private env, không in/commit. Native lỗi/SQL timeout/hash drift nonzero. Caller env dùng bản sao vào process con. `finally` dừng exact container, readback stopped, volume KEEP; test JVM hết khi Maven kết thúc. Không frontend/browser/prune/xóa/archive/push.

Guard1method/2subcases kiểm actual entrypoint refuse existing/outside trước native mutation; không tuyên bố toàn adverse cleanup/env matrix. Test setup reset dữ liệu booking trên fixture giữa các ca; proof lifecycle nằm ở SQL assertions trong source + XML/log, final SQL readback là trạng thái cuối suite, không giữ toàn bộ dataset từng ca. Giữ artifact lịch sử và fixture khi cần đối chiếu.
