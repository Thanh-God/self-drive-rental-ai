# Kho kiến thức Trợ lý KDrive

Trợ lý chỉ được trả lời câu hỏi về dịch vụ KDrive từ các mục kiến thức đã duyệt trong `backend/src/main/resources/ai/kdrive-knowledge.json`. File được nạp một lần khi backend khởi động; file không hợp lệ làm backend dừng khởi động thay vì chạy với kiến thức chưa kiểm tra.

## Cấu trúc

- `version`, `approvedOn` (YYYY-MM-DD): phiên bản và ngày duyệt. Backend tính thêm SHA-256 của file để truy vết câu trả lời theo đúng nội dung đã nạp.
- `answersUnchangedSince` (tùy chọn): phiên bản gần nhất có cùng nội dung `answer`, khi lần đổi chỉ thêm câu hỏi mẫu. Backend không dùng trường này; công cụ chấm điểm chat chấp nhận bộ câu hỏi đánh giá viết cho phiên bản đó. Đổi bất kỳ `answer` nào thì bỏ hoặc cập nhật trường này.
- `hotline`: `number` (chỉ chữ số) và `sample`. Khi `sample` là true, mọi câu trả lời nhắc số này phải ghi rõ là số mẫu.
- `fallbackReply`: câu trả lời khi kho không có thông tin cho câu hỏi.
- `entries`: mỗi mục có `id` dạng `K-[A-H]NN` (không trùng, chữ cái khớp `group`), `kind` (`ANSWER` hoặc `REFUSAL` cho câu ngoài phạm vi), `status` (`APPROVED` hoặc `DRAFT`), `experimental`, `questions` (câu hỏi mẫu dùng để tìm mục, không phải nội dung trả lời), `answer` (tối đa 1200 ký tự) và `sources`.

Chỉ mục `APPROVED` được nạp; mục `DRAFT` bị bỏ qua. Trạng thái hoặc loại khác, thiếu trường, ID trùng hoặc sai dạng đều bị từ chối.

## Nhóm nội dung

A. Giới thiệu và cách dùng trợ lý · B. Đặt xe và giá · C. Giấy phép lái xe · D. Nhận và trả xe · E. Hủy đơn · F. Sau chuyến đi · G. Ngoài phạm vi · H. Chính sách bổ sung.

Các mục `experimental` (cọc giữ chỗ, chính sách trả xe, hoàn tiền) mô tả chính sách đang thử nghiệm, chỉ áp dụng khi cấu hình tương ứng được bật. Nhóm H là chính sách mô tả; hệ thống chưa tự kiểm tra hoặc tính tiền các nội dung này. Giá, phí tuyến và danh sách chi nhánh không được ghi cứng trong kho. Câu hỏi đáp không nêu các con số này; chỉ thẻ xe ở lượt tìm xe có tổng tiền, do backend tính tại thời điểm hỏi.

## Sửa kho

Sửa nội dung cần được chủ dự án duyệt trước khi đặt `APPROVED`. Đổi nội dung phải tăng `version`. Hotline trong kho cần khớp cấu hình `AI_HOTLINE`/`AI_HOTLINE_SAMPLE` của [hạn mức câu hỏi](ai-assistant.md#hạn-mức-câu-hỏi-ai-mỗi-ngày).

## Chọn đoạn liên quan

Trước khi gọi model, backend chọn tối đa 4 mục `ANSWER` liên quan đến câu hỏi theo cách xác định, không dùng model: chuẩn hóa tiếng Việt (bỏ dấu, chữ thường), so khớp âm tiết và cặp âm tiết với câu hỏi mẫu của từng mục, có trọng số theo độ hiếm. Câu không đủ liên quan không nhận đoạn nào; model khi đó chỉ được dùng câu trả lời mặc định hoặc câu từ chối. Các câu từ chối nhóm G luôn là quy tắc cố định trong hướng dẫn cho model, không phải đoạn được chọn.

Hướng dẫn cho model gồm quy tắc, các đoạn kèm ID và phiên bản kho; tin nhắn của khách luôn ở vai người dùng, không ghép vào hướng dẫn. Không gửi tài khoản, token hay ID người dùng. Câu hỏi hiện tại 1–1000 ký tự và bị từ chối nếu có email, số điện thoại hoặc số giấy tờ; lịch sử chỉ giữ 6 lượt gần nhất, tối đa 2000 ký tự, bỏ lượt có các dữ liệu này.
