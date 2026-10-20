# Chạy proof AI4 tại local

Kiểm tra cấu hình và quy tắc fixture cô lập trước khi chạy. Không trỏ test ghi dữ liệu vào33385/3306. Tận dụng harness `../c14-core/run-mysql.py` và `run-browser.py`; không cài dependency mới.

1. Copy nguyên backend source, .mvn, pom.xml và Maven wrapper vào thư mục backend mới trong .runtime; copy scripts/ai/locations-pilot.json cạnh backend vào scripts/ai để dataset test đọc được. Java21 Maven verify phải đạt. Giữ Flyway validate/Hibernate validate.
2. Chạy guarded MySQL runner với `--suites ItineraryStorageIntegrationTest`, backend copy đã verify và `--reuse-evidence` là fixture stopped có identity rõ. Thư mục parent evidence cần historical-migration với2file V1/V2 theo harness; suite này không chạy migration lịch sử. Giữ evidence mới, không overwrite.
3. Chạy `python scripts/coordination/ai4/run-live-proof.py --backend-root .runtime/<build>/backend --native .runtime/<build>/native --evidence .runtime/<new-live>`; có thể truyền `--reuse-osrm <exact-stopped-ai4-proof-name>` để tái dùng container của proof trước. Kiểm image, readonly graph mount/hash trước start.

Cần graph `.runtime/coordination-ai3-20261019/osrm-central` và graph-manifest.json có image digest/hash đúng; model có sẵn `qwen3:8b` tại `E:/AI_Cache/ollama`. Không tự pull model hoặc cloud fallback. Nếu Ollama chưa chạy, proof khởi động process riêng, NO_CLOUD/NOPRUNE, nạp model trước browser và dừng process đó sau test. Nạp model lạnh có thể lâu trên máy ít RAM/GPU; ứng dụng vẫn giữ timeout60giây và trả UNAVAILABLE nếu quá hạn. API client preview chờ tối đa65giây. Không nâng timeout để biến ca lỗi thành PASS.

Provider có sẵn không được tự dừng. Proof từ chối cổngOSRM5000đãbịchiếm, và chỉ chạy ca tắt Qwen nếu proof sở hữu process. Bất kỳ ca không chạy phải ghi rõ giới hạn, không suy PASS. Driver dùng MySQL33676/JAR8300/Vite5300, schema riêng, lưu expected/actual/SQLreadback/screenshots1440/1280. Sau test dừng đúng process/fixture do lượt khởi động, giữ container/volume/graph/evidence. Không prune.

Playwright dùng bản đã có của workspace qua C11_PLAYWRIGHT, không thay thế dữ liệu thật bằng mock. BrowserAct CLI/runtime không có tại lượt này nên proof dùng Chromium headless của harness. Lỗi main paths/log không được lộ secrets; config private chỉ local ignored. Source hashes trước/sau phải khớp. Không dùng báo cáo hay container tên PASS thay cho assertions thực.
