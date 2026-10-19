# Kiểm chứng auth/UI

Chạy từ repository root với JDK 21, Python 3.12, Node, Docker và cache Maven `.runtime/m2`. Kiểm tra cấu hình và điều kiện môi trường dưới đây trước khi chạy. Không dùng DB gốc 33385/3306.

Chuẩn bị backend copy sạch dưới thư mục evidence mới (pom.xml, Maven wrapper, .mvn, src); chạy Maven verify với cache của repository. Không copy target cũ. Runner bắt buộc đối chiếu source copy với workspace và JAR với classes.

```powershell
python -X utf8 scripts/coordination/auth-ui-review/run-mysql.py --backend-root <backend-copy> --evidence <new-mysql-evidence>
python -X utf8 scripts/coordination/auth-ui-review/run-browser.py --backend-root <backend-copy> --backend-evidence <mysql-evidence> --evidence <new-browser-evidence>
python -X utf8 scripts/coordination/auth-ui-review/test_guards.py
```

Dùng Python đã cài ở E:\MT_Python\python312 nếu python không có trên PATH. Browser dùng Playwright/browsers đã có trong `.runtime/phase5-rerun-20261004-1823`; không tự tải dependency. Browser runner tái dùng đúng fixture của MySQL runner; không tạo container mới khi sửa cùng lỗi. Không dùng tùy chọn fresh-schema cho lượt này. Ports fixture 33674/backend 8298/frontend 5298 phải trống.

Evidence directory phải mới; giữ log thất bại và kết quả. `mysql.private.env`/cấu hình backend riêng có credentials fixture: không in, commit hoặc chia sẻ. Cuối runner dừng đúng owned process/container, giữ volume và cleanup readback. Không prune/clean/repair MySQL. Kiểm thử trình duyệt sử dụng Playwright; kết quả DOM mock không thay thế kiểm chứng trên MySQL.
