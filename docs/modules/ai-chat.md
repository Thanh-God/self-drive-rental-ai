# Hỏi đáp Trợ lý KDrive — API

POST `/api/v1/ai/chat` chỉ dành cho USER đã đăng nhập (chưa đăng nhập 401, STAFF/ADMIN 403). Trợ lý chỉ trả lời về dịch vụ KDrive từ [kho kiến thức đã duyệt](ai-knowledge.md) và dùng Qwen cục bộ; bật cùng cờ `QWEN_PARSER_ENABLED`, tắt thì trả 503.

## Yêu cầu

```json
{ "message": "Đơn chờ xác nhận được giữ bao lâu?",
  "messages": [ { "role": "user", "text": "Xin chào" }, { "role": "assistant", "text": "Chào bạn…" } ] }
```

`criteria` (tùy chọn) là tiêu chí tìm xe mà phản hồi trước trả về, trình duyệt gửi lại nguyên dạng: `{pickupDate, returnDate, pickupBranchId, returnBranchId, passengers, budgetVndTotal, transmission}`. Backend kiểm lại từng giá trị và bỏ giá trị không hợp lệ hoặc chi nhánh không còn hoạt động.

`message` 1–1000 ký tự. `messages` là lịch sử do trình duyệt giữ, tối đa 20 lượt, `role` là `user` hoặc `assistant`, mỗi lượt tối đa 1000 ký tự. Backend chỉ gửi cho model 6 lượt gần nhất trong 2000 ký tự; không lưu hội thoại. Câu hỏi có email, số điện thoại hoặc số giấy tờ bị từ chối 400 trước khi gọi model; lượt lịch sử có các dữ liệu này bị bỏ.

## Phản hồi

```json
{ "intent": "ANSWER", "reply": "…", "citations": [ { "id": "K-B04", "title": "Đơn chờ xác nhận được giữ bao lâu?" } ],
  "knowledgeVersion": "2026-11-11-v1", "criteria": null, "missing": [], "cards": [],
  "quota": { "limit": 6, "used": 1, "remaining": 5, "resetAt": "2026-11-11T17:00:00Z", "hotline": { "number": "10008888", "sample": true } } }
```

`intent`: `ANSWER` (trả lời từ kho, hoặc câu “chưa có thông tin” khi kho không có), `ASK_MISSING` (tìm xe còn thiếu thông tin), `SEARCH_VEHICLES` (đã tìm xe), `OUT_OF_SCOPE` (câu từ chối đã duyệt). `citations` là các mục kiến thức đã dùng.

## Tìm xe trong trò chuyện

Mỗi tin nhắn chỉ gọi model một lần; model đề xuất tiêu chí từ tin nhắn hiện tại, backend chỉ giữ giá trị câu của khách xác nhận theo cùng quy tắc với [đọc nhu cầu](ai-assistant.md): ngày phải ghi đủ năm, chi nhánh phải được nhắc tên và đang hoạt động, hộp số chỉ khi khách nêu rõ. Giá trị mới thay giá trị trong `criteria` gửi lên; trường khách vừa để ngỏ được hỏi lại. Thiếu thông tin thì `intent` là `ASK_MISSING`, `missing` liệt kê các trường còn thiếu theo thứ tự và `reply` hỏi một trường bằng câu do backend soạn. Đủ thông tin thì backend tìm bằng [gợi ý xe](ai-recommendation.md) (cần bật `AI_RECOMMENDATION_ENABLED`) và trả tối đa 3 thẻ `cards`: `{vehicleId, vehicleName, seats, transmission, rentalDays, rentalTotal, oneWayFee, total, reasonCodes}`; tổng tiền gồm phí tuyến do backend tính. Không có xe phù hợp thì không có thẻ và `reply` gợi ý sửa tiêu chí. Câu trả lời ở lượt tìm xe không dùng chữ của model. Không giữ chỗ hay tạo đơn; giá và lịch được kiểm tra lại khi đặt.

## Kiểm soát ở backend

Model chỉ soạn nháp; backend quyết định nội dung trả về:
- Trích dẫn phải là mục đã cấp cho model; câu trả lời không có trích dẫn hợp lệ được thay bằng câu “chưa có thông tin” đã duyệt.
- Câu từ chối đã duyệt luôn có `intent` `OUT_OF_SCOPE` và không kèm nguồn; câu “chưa có thông tin” cũng không kèm nguồn.
- Câu ngoài phạm vi dùng đúng câu từ chối đã duyệt; câu thuộc lĩnh vực thuê xe mà kho không có thông tin nhận câu “chưa có thông tin” thay vì từ chối.
- Số tiền hoặc tỉ lệ không có trong mục được trích hoặc câu của khách bị thu hồi; giá, phí và lịch xe chỉ lấy từ hệ thống.
- Tin nhắn có dấu hiệu chèn lệnh mà không có mục liên quan được trả lời bằng câu từ chối, không gọi model; trả lời không có trích dẫn cho tin nhắn như vậy cũng bị thay bằng câu từ chối.
- Hotline mẫu luôn được ghi rõ là số mẫu.

## Lỗi và hạn mức

Mỗi câu model đã trả lời trừ một lượt trong [hạn mức hằng ngày](ai-assistant.md#hạn-mức-câu-hỏi-ai-mỗi-ngày). Không trừ lượt: 400, 401, 403, 503 (tắt hoặc lỗi provider), 429 khi trợ lý đang bận (không có `code`), hết thời gian chờ, và câu backend tự trả lời không cần model. Hết lượt trả 429 `code: "AI_DAILY_LIMIT"`, không gọi model.
