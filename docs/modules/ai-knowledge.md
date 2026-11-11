# Kho kiến thức Trợ lý KDrive

Trợ lý chỉ được trả lời câu hỏi về dịch vụ KDrive từ các mục kiến thức đã duyệt trong `backend/src/main/resources/ai/kdrive-knowledge.json`. File được nạp một lần khi backend khởi động; file không hợp lệ làm backend dừng khởi động thay vì chạy với kiến thức chưa kiểm tra.

## Cấu trúc

- `version`, `approvedOn` (YYYY-MM-DD): phiên bản và ngày duyệt. Backend tính thêm SHA-256 của file để truy vết câu trả lời theo đúng nội dung đã nạp.
- `hotline`: `number` (chỉ chữ số) và `sample`. Khi `sample` là true, mọi câu trả lời nhắc số này phải ghi rõ là số mẫu.
- `fallbackReply`: câu trả lời khi kho không có thông tin cho câu hỏi.
- `entries`: mỗi mục có `id` dạng `K-[A-H]NN` (không trùng, chữ cái khớp `group`), `kind` (`ANSWER` hoặc `REFUSAL` cho câu ngoài phạm vi), `status` (`APPROVED` hoặc `DRAFT`), `experimental`, `questions` (câu hỏi mẫu dùng để tìm mục, không phải nội dung trả lời), `answer` (tối đa 1200 ký tự) và `sources`.

Chỉ mục `APPROVED` được nạp; mục `DRAFT` bị bỏ qua. Trạng thái hoặc loại khác, thiếu trường, ID trùng hoặc sai dạng đều bị từ chối.

## Nhóm nội dung

A. Giới thiệu và cách dùng trợ lý · B. Đặt xe và giá · C. Giấy phép lái xe · D. Nhận và trả xe · E. Hủy đơn · F. Sau chuyến đi · G. Ngoài phạm vi · H. Chính sách bổ sung.

Các mục `experimental` (cọc giữ chỗ, chính sách trả xe, hoàn tiền) mô tả chính sách đang thử nghiệm, chỉ áp dụng khi cấu hình tương ứng được bật. Nhóm H là chính sách mô tả; hệ thống chưa tự kiểm tra hoặc tính tiền các nội dung này. Giá, phí tuyến và danh sách chi nhánh không được ghi cứng trong kho; trợ lý lấy từ backend tại thời điểm hỏi.

## Sửa kho

Sửa nội dung cần được chủ dự án duyệt trước khi đặt `APPROVED`. Đổi nội dung phải tăng `version`. Hotline trong kho cần khớp cấu hình `AI_HOTLINE`/`AI_HOTLINE_SAMPLE` của [hạn mức câu hỏi](ai-assistant.md#hạn-mức-câu-hỏi-ai-mỗi-ngày).
