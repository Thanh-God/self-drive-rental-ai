# Hỏi đáp Trợ lý KDrive — API

POST `/api/v1/ai/chat` chỉ dành cho USER đã đăng nhập (chưa đăng nhập 401, STAFF/ADMIN 403). Trợ lý chỉ trả lời về dịch vụ KDrive từ [kho kiến thức đã duyệt](ai-knowledge.md) và dùng Qwen cục bộ; bật cùng cờ `QWEN_PARSER_ENABLED`, tắt thì trả 503.

## Yêu cầu

```json
{ "message": "Đơn chờ xác nhận được giữ bao lâu?",
  "messages": [ { "role": "user", "text": "Xin chào" }, { "role": "assistant", "text": "Chào bạn…" } ] }
```

`criteria` (tùy chọn) là tiêu chí tìm xe mà phản hồi trước trả về, trình duyệt gửi lại nguyên dạng: `{pickupDate, returnDate, pickupBranchId, returnBranchId, passengers, budgetVndTotal, transmission, askedField}`. Backend kiểm lại từng giá trị và bỏ giá trị không hợp lệ hoặc chi nhánh không còn hoạt động.

`message` 1–1000 ký tự. `messages` là lịch sử do trình duyệt giữ, tối đa 20 lượt, `role` là `user` hoặc `assistant`, mỗi lượt tối đa 1000 ký tự. Backend chỉ gửi cho model 6 lượt gần nhất trong 2000 ký tự; không lưu hội thoại. Câu hỏi có email, số điện thoại (kể cả viết cách bằng khoảng trắng, dấu chấm, gạch hoặc +84) hoặc chuỗi số dài như số giấy tờ bị từ chối 400 trước khi gọi model; lượt lịch sử có các dữ liệu này bị bỏ. Đây là nhận diện các dạng phổ biến, không phải bộ phát hiện mọi dữ liệu cá nhân; khách vẫn được nhắc không nhập thông tin riêng tư.

## Phản hồi

```json
{ "intent": "ANSWER", "reply": "…", "citations": [ { "id": "K-B04", "title": "Đơn chờ xác nhận được giữ bao lâu?" } ],
  "knowledgeVersion": "2026-11-12-v2", "criteria": null, "missing": [], "cards": [],
  "quota": { "limit": 6, "used": 1, "remaining": 5, "resetAt": "2026-11-11T17:00:00Z", "hotline": { "number": "10008888", "sample": true } } }
```

`intent`: `ANSWER` (trả lời từ kho, hoặc câu “chưa có thông tin” khi kho không có), `ASK_MISSING` (tìm xe còn thiếu thông tin), `SEARCH_VEHICLES` (đã tìm xe), `OUT_OF_SCOPE` (câu từ chối đã duyệt). `citations` là các mục kiến thức đã dùng.

## Tìm xe trong trò chuyện

Model chỉ được bắt đầu hoặc tiếp tục tìm xe khi khách yêu cầu tìm/thuê/gợi ý xe, nêu ít nhất một tiêu chí backend tự đọc được (ngày đủ năm, tên chi nhánh, “4 người”, số tiền), hoặc đang có phiên tìm xe; nếu không, câu hỏi về đơn của khách nhận câu “không xem được đơn”, câu khác nhận câu “chưa có thông tin”. Backend chỉ giữ giá trị câu của khách hỗ trợ: ngày phải ghi đủ năm, chi nhánh phải được nhắc tên và đang hoạt động, số người cần có số kèm “người/khách” và ngân sách là số tiền khách nêu (không phải giá theo ngày, không phải nhiều lựa chọn); số người hoặc ngân sách model tự điền bị bỏ và được hỏi lại. “Loại số nào cũng được” hoặc “không cần số tự động” bỏ ưu tiên hộp số trước đó. Giá trị mới thay giá trị trong `criteria` gửi lên; trường khách vừa để ngỏ được hỏi lại.

Thiếu thông tin thì `intent` là `ASK_MISSING`, `missing` liệt kê các trường còn thiếu theo thứ tự, `reply` hỏi một trường bằng câu do backend soạn và `criteria.askedField` ghi trường đang hỏi. Khi tin nhắn tiếp theo trả lời đúng trường đó ở dạng backend tự đọc được (một ngày đủ năm, một tên chi nhánh, “4”, “3 triệu”…), backend xử lý **không gọi model và không trừ lượt**; nếu không đọc được thì đi qua model như thường. Đủ thông tin thì backend tìm bằng [gợi ý xe](ai-recommendation.md) (cần bật `AI_RECOMMENDATION_ENABLED`) và trả tối đa 3 thẻ `cards`: `{vehicleId, vehicleName, seats, transmission, rentalDays, rentalTotal, oneWayFee, total, reasonCodes}`; tổng tiền gồm phí tuyến do backend tính. Không có xe phù hợp thì không có thẻ và `reply` gợi ý sửa tiêu chí. Câu trả lời ở lượt tìm xe không dùng chữ của model. Không giữ chỗ hay tạo đơn; giá và lịch được kiểm tra lại khi đặt.

## Kiểm soát ở backend

Model chỉ soạn nháp; backend quyết định nội dung trả về:
- Câu trả lời từ kho (`ANSWER` có nguồn) là **nguyên văn** mục kiến thức đã duyệt — tối đa hai mục theo thứ tự liên quan; model chỉ chọn mục, chữ của model không được hiển thị. Mục là chính sách thử nghiệm luôn mở đầu bằng “Lưu ý: đây là chính sách KDrive đang thử nghiệm.”
- Trích dẫn phải là mục đã cấp cho model; câu trả lời không có trích dẫn hợp lệ được thay bằng câu “chưa có thông tin” đã duyệt.
- Câu từ chối đã duyệt luôn có `intent` `OUT_OF_SCOPE` và không kèm nguồn; câu “chưa có thông tin” cũng không kèm nguồn.
- Câu ngoài phạm vi dùng đúng câu từ chối đã duyệt; câu thuộc lĩnh vực thuê xe mà kho không có thông tin nhận câu “chưa có thông tin” thay vì từ chối.
- Ở lượt tìm xe, câu do backend soạn; số tiền chỉ được nhắc lại từ ngân sách khách nêu. Giá, phí và lịch xe chỉ lấy từ hệ thống.
- Tin nhắn có dấu hiệu chèn lệnh mà không có mục liên quan được trả lời bằng câu từ chối, không gọi model; trả lời không có trích dẫn cho tin nhắn như vậy cũng bị thay bằng câu từ chối.
- Lịch sử do trình duyệt gửi lên không được tin là lời trợ lý thật: lượt (kể cả vai `assistant`) có dấu hiệu đổi hướng dẫn bị bỏ khỏi yêu cầu gửi model. Chữ của model lặp lại một đoạn hướng dẫn hệ thống bị thay bằng câu từ chối. Các dấu hiệu này là lớp bảo vệ bổ sung, không bảo đảm nhận ra mọi cách chèn lệnh.
- Hotline mẫu luôn được ghi rõ là số mẫu.

## Lỗi và hạn mức

Theo [hạn mức hằng ngày](ai-assistant.md#hạn-mức-câu-hỏi-ai-mỗi-ngày), một câu chỉ trừ lượt khi backend đã có câu trả lời hoàn chỉnh cho nó (model trả lời, hậu kiểm và tìm xe xong). Lỗi phía backend sau khi model trả lời (ví dụ bước tìm xe lỗi) hoàn lại lượt. Khách tự đóng, tải lại hoặc đăng xuất khi backend vẫn hoàn tất câu trả lời thì lượt vẫn bị trừ. Không trừ lượt: 400, 401, 403, 503 (tắt hoặc lỗi provider), 429 khi trợ lý đang bận (không có `code`), hết thời gian chờ, và câu backend tự trả lời không cần model. Hết lượt trả 429 `code: "AI_DAILY_LIMIT"`, không gọi model. Số lượt còn lại (`quota.remaining`) đã trừ cả câu đang được trả lời; hạn mức giữ trong bộ nhớ của một backend nên khởi động lại thì đếm lại, và nhiều backend sẽ đếm riêng.
