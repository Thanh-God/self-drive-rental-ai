> Adapter Gemini hiện tắt; luồng chatbox dùng [Qwen cục bộ](local-ai-routing.md). Tài liệu này mô tả adapter dự phòng, không phải cấu hình đang chọn.

# Adapter Gemini cho trích xuất nhu cầu

`CriteriaParser` là hợp đồng nội bộ cho đầu ra trích xuất chưa đáng tin. `GeminiCriteriaParser` gọi REST `generateContent` bằng Java HttpClient, không dùng SDK mới hoặc truy cập database. Chỉ được tạo bean khi `app.gemini-parser-enabled=true`; mặc định false.

Đây là lớp adapter chuẩn bị cho hội thoại. Chưa có endpoint parse công khai hoặc nối vào chatbox, chưa có bước làm sạch thông tin riêng, ghép tên chi nhánh với ID, xác nhận mâu thuẫn, hạn mức user/toàn hệ thống hoặc kích hoạt production. Không được bật như một API đã nghiệm thu đầu-cuối.

Cấu hình backend:
```dotenv
GEMINI_PARSER_ENABLED=false
GEMINI_MODEL=<model chính xác đã xác nhận quyền sử dụng>
GEMINI_API_KEY=<chỉ lưu trong môi trường backend riêng>
```
Không đặt key ở frontend, URL, Git hoặc log. `backend/.env.local` bị Git bỏ qua nhưng Spring không tự nạp; launcher phải nạp biến môi trường. Không ghi đè các cấu hình DB/JWT có sẵn. Giữ false đến khi xác nhận điều kiện tài khoản, dữ liệu, hạn mức và nghiệm thu.

Production host cố định `generativelanguage.googleapis.com`, model phải theo mẫu `gemini-*`, header `x-goog-api-key`, không theo redirect, không tools/function execution hoặc retry tự động. Yêu cầu có system instruction và schema, giới hạn input1000ký tự, candidate1, maxOutputTokens512. Deadline toàn response8giây. Body được đọc hoàn tất rồi từ chối nếu vượt16384ký tự; đây không phải giới hạn bộ nhớ theo streaming. JSON trích xuất tối đa4096ký tự, từ chối field ngoài hợp đồng, field trùng, số thập phân cho trường số nguyên, ngày sai, khoảng ngày đảo và enum/range sai. Không có cam kết 512 token tương đương một số tiền cố định.

Đầu ra gồm intent, ngày nhận/trả nếu biết, tên chi nhánh, số người, tổng ngân sách, hộp số, unresolvedFields và conflicts. Không trả price/availability/vehicleId/ownerId. Caller tương lai phải tiếp tục đối chiếu catalog và quy tắc booking; schema không xác nhận mô hình đã hiểu đúng câu. `redactedText` là đầu vào đã làm sạch theo hợp đồng caller; adapter không tự bảo đảm phát hiện mọi dữ liệu cá nhân.

Chỉ chấp nhận một candidate STOP và một text part; output bị chặn, tool part, JSON không hợp lệ hoặc upstream lỗi được trả lỗi đã loại bỏ nội dung nhạy cảm. HTTP429 giữ ngữ nghĩa hết hạn mức. Không đưa raw lỗi/provider body/key vào exception trả caller.

Gói Google AI Pro của ứng dụng và quyền API/project phải được kiểm tra riêng. Một số quyền lợi AI Studio của thuê bao không chứng minh model/API/backend có hạn mức tương ứng. Với chính sách chỉ sử dụng không phát sinh phí, phải xác nhận project và model trước smoke. Không tự chuyển model/tier hoặc bật billing khi hết quota. Ngày hết hạn gói ứng dụng không tự là ngày mọi quyền API kết thúc.

Tham khảo [Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key), [GenerateContent REST](https://ai.google.dev/api/generate-content), [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output). Adapter hiện dùng responseMimeType/responseSchema thuộc bề mặt tương thích GenerateContent được tài liệu REST mô tả; trước smoke phải xác minh model thực hỗ trợ và rà soát lộ trình responseFormat mới. Không coi kiểm thử máy chủ cục bộ là xác nhận model thực hỗ trợ request.
