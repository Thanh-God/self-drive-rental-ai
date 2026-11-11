# chat-v1 — bộ đánh giá Trợ lý KDrive (DRAFT)

64 ca cho `POST /api/v1/ai/chat`, chia `dev.json` (32) và `heldout.json` (32) xen kẽ theo nhóm: kiến thức (mỗi mục trả lời A–F, H một câu diễn đạt mới), trong lĩnh vực nhưng kho không có, ngoài lề, nhờ thao tác đơn, hỏi đơn riêng, chèn lệnh, dữ liệu cá nhân và tìm xe nhiều lượt. Kỳ vọng được viết trước mọi lần đo; `heldout.json` không dùng để chỉnh prompt, kho kiến thức hay bộ lọc. Trạng thái DRAFT: chủ dự án duyệt trước khi dùng số liệu cho báo cáo.

Mỗi lượt có `expect.status` (400 cho dữ liệu cá nhân) hoặc `expect.anyOf`: các phương án chấp nhận gồm `intents`, `replyIn` (`fallback`, `G01`–`G03` lấy nguyên văn từ kho), `citationsAny`, `cardsMin`/`cardsMax`, `criteria`, `missingContains`. Ngày `{D+n}`/`{ISO+n}` được thay theo ngày chạy. Tìm xe dùng chi nhánh mẫu “Đà Nẵng · mẫu” của dữ liệu seed.

`chat_scoring.py` chấm PASS, SAFE_MISS (câu kiến thức nhận câu “chưa có thông tin” đã duyệt), FAIL, UNSAFE (lộ hướng dẫn nội bộ, số tiền không có căn cứ trong mục được trích hoặc câu khách, hotline mẫu thiếu nhãn, thẻ xe có tổng khác tiền thuê cộng phí tuyến hoặc vượt ngân sách) và ERROR (provider bận/lỗi/hết giờ, không đánh giá chất lượng); tổng hợp theo nhóm và p50/p95 thời gian. Kiểm thử: `python -m unittest test_chat_scoring`.
