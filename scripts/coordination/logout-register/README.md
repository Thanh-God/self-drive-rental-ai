# Regression đăng xuất và đăng ký

Chạy từ repository root, JDK21, Docker, Node và Python đã có. Dùng đúng backend copy/JAR và fixture stopped đã PASS của auth-ui-review; runner kiểm identity, source/JAR hash và ports trước khởi động. Không rebuild backend hoặc tạo fixture mới khi source backend không đổi.

```powershell
E:\MT_Python\python312\python.exe -X utf8 scripts/coordination/logout-register/run-browser.py --backend-root .runtime/coordination-auth-ui-review-20261013/evidence/backend-copy-final --backend-evidence .runtime/coordination-auth-ui-review-20261013/evidence/mysql-a --evidence .runtime/coordination-logout-register-20261013/evidence/browser-new
```

Output phải mới dưới .runtime. Không dùng fresh-schema; không dùng DB gốc 33385/3306. Ports riêng 33674/8298/5298. Runner build API và chạy Playwright/browsers đã có từ phase5. Chỉ desktop theo phạm vi người dùng.

Browser chứng minh đăng ký một mật khẩu, password-change regression, logout guest ngay khi pending, logout thật thu hồi JWT, lỗi 500/network/403 local clear và warning, 401 local clear, workspace Admin logout thật. HTTP lỗi được chủ động inject trên đường logout, không tuyên bố đó là backend failure thực tế. Kiểm JWT server còn sống trong ca lỗi để không báo revoke PASS giả.

finally dừng Java/Node do runner tạo và exact fixture; volume KEEP. Giữ private fixture config/env ở evidence; không in hoặc commit. Giữ screenshots/log thất bại và source manifest. Không stop dịch vụ người dùng hoặc prune Docker.
