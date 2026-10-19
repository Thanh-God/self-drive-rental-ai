# Urban BrandBar visual QA

Chạy từ root, dùng JDK21/Python312/Docker và Playwright/cache đã có. run-browser.py là bản sao runner C11-A4, kiểm exact stopped fixture ab7d69ba6237/JAR/inputs, backend8299/frontend5299/MySQL33675. Không dùng DB gốc33385/3306 hoặc prune. Backend source hiện không đổi, dùng clean copy/JAR đã có.

```powershell
E:\MT_Python\python312\python.exe -X utf8 scripts/coordination/urban-brandbar/run-browser.py --backend-root <runtime-backend-copy> --backend-evidence <mysql-evidence> --fresh-schema --evidence .runtime/coordination-urban-brandbar-20261013/evidence/browser-new
```

Output phải mới. Mỗi browser lượt có schema riêng trong cùng fixture, giữ schema cũ; không thêm container cho cùng lỗi. Seed3xe/ảnh registry đã kiểm nguồn; chụp clean screenshots rồi thêm9hãng/10xe và1hãngkhôngxe để kiểm dữ liệu động (chỉ fixture). No hardcoded manufacturer list trong production. Testviewport1280/1440/390, DPR2, buttonstates,compiledCSS1.5border/computedChromium1px,contrast/ARIA/dropdown/history/query, exactDOMcountwait sauReacttransition.

Dùng Playwright đã cài trong môi trường local; không thêm dependency. finally dừng ownedJava/Node/Chromium/exactfixture,KEEPvolume/schema/evidence. Runtime privateenv/config chứa fixturecredentials: không in hoặc commit. Test/log/screenshots cũ giữ; không sửa expected HTTP để che production lỗi (vehicle create200 theo contract controller). Frontendgates chạy tuần tự, không build demo/API đồng thời vào dist. Không push.
