# C11-A4 — MySQL, browser và location regression

Chạy tuần tự từ repository root Windows với JDK21, Python312, Docker mysql:8.4 và dependency/cache đã có. Không dùng DB gốc33385/3306. Tạo backend copy riêng trong .runtime, src/pom/wrapper phải khớp workspace; classes và JAR lấy từ clean verified build cùng source. Không copy target workspace cũ hoặc ghi đè evidence cũ. Đối chiếu JAR với build hiện tại và ghi riêng số kiểm thử đã chạy, thất bại hoặc bỏ qua.

```powershell
E:\MT_Python\python312\python.exe -X utf8 scripts/coordination/c11-final-browser/test_guards.py
E:\MT_Python\python312\python.exe -X utf8 scripts/coordination/c11-final-browser/run-mysql.py --backend-root <runtime-backend-copy> --evidence <new-runtime-mysql-output>
E:\MT_Python\python312\python.exe -X utf8 scripts/coordination/c11-final-browser/run-browser.py --backend-root <runtime-backend-copy> --backend-evidence <mysql-output> --fresh-schema --evidence <new-runtime-browser-output>
E:\MT_Python\python312\python.exe -X utf8 scripts/coordination/c11-final-browser/run-location.py --backend-root <runtime-backend-copy> --backend-evidence <mysql-output> --evidence <new-runtime-location-output>
```

run-mysql tạo duy nhất fixture riêng33675, marker và volume riêng.10nativeMySQLtests A1/A2, hai lockwaitreadback thật, XML nofail/noskip, source/JARbyte provenance. run-browser tái khởi động exact stopped fixture; schema mới cho từng browser lượt (giữ schema cũ), backend8299/frontend5299; production clock không đổi, booking start30giây tới, xác nhận trước start rồi đợi thật để giao. Không chuyển timestamp DB để đạt PASS.

Kiểm thử trình duyệt dùng Playwright và bộ trình duyệt đã cài trong môi trường local. Desktop1280/1440/1920, Admin/status/stale/reload/400/pending, User closed quote/create, Staff old booking lifecycle, SQL equality/26tables/37FK. SQL CLI bắt buộc UTF8mb4/raw để không làm sai snapshot tiếng Việt. Console HTTP400/409 và abortedGET là ca âm có chủ đích; pageerror phải rỗng.

run-location giữ cùng fixture, tạo schema+marker riêng,6SpringMockMvc/MySQLtests của module địa điểm; không tuyên bố MockMvc là HTTP network. Credentials chỉ trong private env/properties runtime, không in hoặc commit. Source backend/JAR giữ nguyên sau native checks. Guard1method/2subcases chỉ kiểm run-mysql existing/outside refusal; không tuyên bố full adverse matrix cho mọi runner.

Sau mỗi runner finally dừng exact owned fixture; browser dừng Java/Node do mình tạo. Volume/schema/log/screenshots/XML KEEP; không prune/clean/repair/xóa. Sau tất cả gates đọc identity/stopped/originalDB. Không push.
