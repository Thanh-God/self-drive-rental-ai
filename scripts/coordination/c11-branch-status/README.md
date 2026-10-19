# C11-A1 — HTTP trên MySQL cô lập

Chạy từ root `E:\AI\BERT_Project\codepython\KLTN` trên Windows với Docker mysql:8.4, JDK21, Python312 và Maven cache `.runtime/m2` có sẵn. Kiểm tra cấu hình và điều kiện môi trường trước khi chạy.

1. Tại `backend/`, JAVA_HOME=`E:\Tools\Java\jdk-21.0.12.1+1`, chạy `./mvnw.cmd -o -B -ntp -Dmaven.repo.local=E:/AI/BERT_Project/codepython/KLTN/.runtime/m2 verify`. Không nạp biến DB gốc cho test.
2. Tại root: `E:/MT_Python/python312/python.exe -X utf8 scripts/coordination/c11-branch-status/test_guards.py`.
3. `E:/MT_Python/python312/python.exe -X utf8 scripts/coordination/c11-branch-status/run-mysql.py --evidence .runtime/<new-run>/mysql`.

Runner từ chối output đã tồn tại/nằm ngoài `.runtime`, kiểm cổng33672 và identity container/volume trước tạo. Một fixture MySQL riêng, marker schema riêng xác minh trước Spring/Flyway; test gọi actual HTTP server random port và so SQL. Runner chỉ truyền bản sao environment vào process con, không sửa caller. XML phải đúng4test methods,0failure/error/skip; packaged JAR classes/resources phải khớp byte với compiled tree được dùng bởi tests, source before/after phải giống nhau.

Native command lỗi/SQL readiness timeout/source drift làm nonzero. `finally` dừng exact container do runner tạo và readback stopped; giữ volume/evidence. Maven kết thúc trước readback; HTTP test server cùng test JVM kết thúc khi Maven hoàn tất. Không start frontend, không dùng DB33385/3306, không prune/xóa/archive.

`mysql.private.env` chỉ chứa credential fixture ở `.runtime` ignored; không in hoặc commit. Evidence: XML/HTTP test log, source hashes, JAR provenance, SQL readback, fixture identity, cleanup. Guard test có1method/2subcases, chỉ chứng minh refuse existing/outside trước native mutation; không tuyên bố toàn adverse cleanup đã được kiểm. Backend verify có thể có optional skip ở suites khác: báo tách, không đếm skip là PASS.
