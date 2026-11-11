# Trợ lý KDrive — chatbox gợi ý xe

Khách có thể chỉ rõ hai vai trò, ví dụ “nhận tại A, trả tại B”, hoặc nói rõ cùng một chi nhánh cho cả hai đầu. Nếu một điểm chưa chọn, không hoạt động, trùng tên hoặc còn nhiều lựa chọn, draft giữ điểm đã xác định và hỏi lại điểm còn thiếu. Hai số người chưa chọn cũng cần được làm rõ trước khi gửi gợi ý.

Khách có thể ghi “số tay”, “hộp số AUTO” hoặc cho biết cả hai đều được. Với ngân sách, trợ lý dùng tổng tiền thuê mà khách nêu rõ, chẳng hạn “bốn triệu rưỡi đồng cho cả chuyến”. Nếu khách chỉ nêu giá theo ngày hoặc đưa ra hai mức tiền chưa chọn, biểu mẫu yêu cầu bổ sung tổng tiền.

Khi đọc nhu cầu, backend lấy các tên chi nhánh đang hoạt động được nhắc trong câu và giới hạn hai trường nhận/trả của model vào các tên đó hoặc giá trị trống. Tên không xác định hoặc trùng nhiều chi nhánh cần được khách làm rõ. Khách có thể ghi “hộp số AUTO” để nêu lựa chọn số tự động.

Nút Trợ lý KDrive dành cho USER đã đăng nhập, ở góc dưới bên phải các trang desktop: trang chủ, danh sách/chi tiết xe, danh sách/chi tiết/tạo đơn thuê và hồ sơ. Không hiển thị cho Guest/Staff/Admin hoặc trang đăng nhập, chứng từ. Mobile chưa được triển khai; dưới768px nút được ẩn.

Chatbox mở theo thao tác người dùng, có thu nhỏ/đóng, Escape và trả focus về nút mở. Bắt đầu lại xóa cuộc trò chuyện. Cuộc trò chuyện và tiêu chí tìm xe chỉ giữ trong bộ nhớ khi chuyển trang SPA; tải lại trang, đăng xuất, đổi tài khoản hoặc đổi phiên sẽ xóa. Không lưu hội thoại trong database, localStorage hay sessionStorage. Bắt đầu lại hoặc đổi phiên hủy câu đang chờ và bỏ phản hồi muộn; đóng chatbox khi trợ lý đang trả lời thì câu hỏi được trả lại ô nhập.

Chatbox là khung trò chuyện dùng [API hỏi đáp](ai-chat.md): lời chào, ba câu hỏi gợi ý khi chưa có tin nhắn, danh sách tin nhắn và ô nhập (Enter gửi, Shift+Enter xuống dòng, tối đa 1000 ký tự). Trong lúc chờ hiện “Đang trả lời…” và không gửi thêm. Lịch sử và tiêu chí tìm xe phản hồi trả về được gửi lại ở lượt sau. Chatbox không còn biểu mẫu tiêu chí; trang [Tìm xe](ai-recommendation.md) và khối Khám phá địa điểm vẫn có liên kết trong chatbox.

Lỗi của trợ lý (bận, lỗi provider, phản hồi sai định dạng) hiện thông báo, giữ câu hỏi trong ô nhập để gửi lại và không tự tạo câu trả lời. Demo mode chỉ thông báo chưa kết nối, không gọi API.

Thẻ xe và nguồn trích dẫn trong khung trò chuyện được bổ sung ở bước tiếp theo; tìm xe chi tiết dùng trang Tìm xe. Không đặt/hủy/sửa đơn qua chatbox; quote/create vẫn kiểm tra lại GPLX, giá và lịch.

API gợi ý xe mặc định tắt bằng `AI_RECOMMENDATION_ENABLED`. Phân tích văn bản dùng `QWEN_PARSER_ENABLED` và tuyến đường dùng `AI_ROUTING_ENABLED`; các cờ mặc định tắt. Cần chuẩn bị dịch vụ Qwen/OSRM tương ứng theo [hướng dẫn cấu hình cục bộ](local-ai-routing.md). Có source tích hợp không đồng nghĩa tính năng đang bật hoặc đã được kiểm thử trên mọi môi trường.


POST `/api/v1/ai/criteria/parse` chỉ USER, body `{ "text": "..." }` tối đa1000ký tự. Backend từ chối một số mẫu email/số điện thoại/số giấy tờ phổ biến trước khi suy luận; đây không phải bộ phát hiện mọi dữ liệu cá nhân. Không gửi userID/token/hồ sơ hoặc lưu hội thoại cho model. Chỉ đối chiếu tên với điểm nhận/trả ACTIVE qua API nội bộ booking; tên không rõ hoặc nhiều kết quả phải chọn lại. Ngày phải xuất hiện đầy đủ trong câu nhập ở dạng YYYY-MM-DD hoặc ngày/tháng/năm; ngày thiếu năm không tự mặc định. Khi câu có đúng hai ngày đầy đủ theo thứ tự nhận rồi trả và không có từ lưỡng lự như “chưa”, “hoặc”, “khoảng”, backend xác nhận hai ngày đó dù model đánh dấu chưa rõ. Ưu tiên hộp số chỉ được điền khi câu nhập nêu rõ, không được biến dữ liệu thiếu thành mặc định tự động. READY_FOR_REVIEW trả bản nháp cần kiểm tra, NEEDS_CLARIFICATION yêu cầu bổ sung, OUT_OF_SCOPE không tạo bản nháp. Phản hồi có mâu thuẫn không được dùng để điền. Không hỗ trợ hội thoại nhiều lượt hoặc tự xác nhận nghiệp vụ.
API hỏi đáp về dịch vụ KDrive được mô tả tại [Hỏi đáp Trợ lý KDrive](ai-chat.md).

## Hạn mức câu hỏi AI mỗi ngày

Mỗi tài khoản USER có 6 câu hỏi AI mỗi ngày theo lịch Việt Nam; lượt mới có từ 00:00 Asia/Ho_Chi_Minh. Một câu chỉ bị tính khi model đã trả lời, kể cả khi câu nằm ngoài phạm vi. Không tính câu bị từ chối trước khi suy luận (rỗng, quá dài, có email/số điện thoại/số giấy tờ), sai vai trò, parser chưa bật, model đang bận, lỗi hoặc hết thời gian chờ. Gợi ý xe bằng biểu mẫu và xem tuyến/hành trình không tính lượt. Lượt dùng được giữ trong bộ nhớ backend nên khởi động lại backend sẽ đếm lại; các câu đang xử lý cùng lúc vẫn không vượt hạn mức.

GET `/api/v1/ai/quota` chỉ USER, đọc lượt không trừ lượt: `{ "limit": 6, "used": 2, "remaining": 4, "resetAt": "2026-11-11T17:00:00Z", "hotline": { "number": "10008888", "sample": true } }`. Khi hết lượt, POST `/api/v1/ai/criteria/parse` trả 429 với cùng các trường cùng `code: "AI_DAILY_LIMIT"` và `message`, không gọi model. 429 không có mã này là trợ lý đang bận và có thể thử lại.

Chatbox hiện “Còn x/6 lượt hỏi AI hôm nay” và cập nhật sau mỗi câu trả lời. Khi hết lượt, ô nhập và câu gợi ý bị khóa; thông báo cho biết giờ có lượt mới, trang Tìm xe và hotline. Hotline 10008888 là số mẫu cho bản demo và được ghi rõ như vậy khi `hotline.sample` là true.

Cấu hình: `AI_DAILY_LIMIT` (mặc định 6), `AI_HOTLINE` (mặc định 10008888), `AI_HOTLINE_SAMPLE` (mặc định true; đặt false khi dùng số thật).

# Địa điểm và tuyến đường AI3

Trong chatbox, mở “Khám phá địa điểm và tuyến đường” để đọc metadata địa điểm và preview tuyến2–8 điểm theo thứ tự. Graph hiện hỗ trợ vùng Đà Nẵng–Hội An; số liệu chỉ xuất hiện khi tuyến VERIFIED. Thông tin chưa xác minh, nguồn và thời điểm kiểm chứng được hiển thị rõ; không tự lưu itinerary. Xem [contract metadata](location-visit-metadata.md).

Khối khám phá có liên kết đến [hành trình một ngày](ai-itinerary.md): USER chủ động preview rồi lưu/xem lại tại trang riêng. Xem tuyến trong chatbox không tự lưu hành trình.
