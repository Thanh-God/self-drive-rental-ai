# C11 location — kiểm chứng cô lập

Chạy tại root repository trên Windows, JDK21, Python312, Docker mysql:8.4 và Maven cache `.runtime/m2`. Kiểm tra cấu hình và điều kiện môi trường trước khi chạy. Không trỏ vào DB33385/3306. Runner từ chối output đã tồn tại hoặc nằm ngoài `.runtime`; mỗi lần chạy dùng output mới, giữ lịch sử.

1. Tại `backend/`, chạy `./mvnw.cmd -o -B -ntp -Dmaven.repo.local=E:/AI/BERT_Project/codepython/KLTN/.runtime/m2 verify` với JAVA_HOME JDK21. Đây là prerequisite tạo JAR trên source cuối, không coi build là proof HTTP.
2. Tại root: `E:/MT_Python/python312/python.exe -X utf8 scripts/coordination/c11-location/test_guards.py`.
3. `E:/MT_Python/python312/python.exe -X utf8 scripts/coordination/c11-location/run-location.py --evidence .runtime/<new-run>/mysql`.
4. `E:/MT_Python/python312/python.exe -X utf8 scripts/coordination/c11-location/run-browser.py --backend-evidence .runtime/<new-run>/mysql --evidence .runtime/<new-run>/browser --fresh-schema`.

Backend runner tạo một container/volume riêng tại33671, có marker guard; chạy6MySQL integration tests và JAR8297 với HTTP/RBAC/stale/race/rejection SQL readback. Browser runner chỉ restart exact stopped fixture của backend proof, xác nhận source/JAR hash; fresh schema tạo trong container đó để kiểm empty state thật. Vite5297/API `/api/v1` proxy8297, Playwright installed tại phase5 runtime. Desktop1280/1440/1920; không test mobile theo phạm vi người dùng.

Mỗi runner giữ environment bản sao trong process con, không sửa caller. `finally` dừng owned Java/Node và exact container, xác nhận stopped; giữ volume/schema/evidence. Không dừng MySQL gốc, không xóa/prune/archive. Lỗi SQL readiness có deadline hữu hạn. Browser error/retry cố ý abort một GET; retry dùng backend/MySQL thật, không trả dữ liệu mock. Pending giữ response thật để kiểm duplicate submission.

`.private.env` và `.private.properties` chỉ ở runtime ignored: chứa credential fixture, không commit/in ra chat. Evidence gồm XML, HTTP assertions, source/JAR hashes, screenshot, command exits, cleanup và dữ liệu đọc lại. 4guard tests chỉ chứng minh refusal trước mutation, không tuyên bố toàn bộ adverse cleanup đã được kiểm. Source đổi phải chạy lại proof bị tác động; prerequisites cache/Playwright thiếu là blocker.
