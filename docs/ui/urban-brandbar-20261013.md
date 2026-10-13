# Giao diện Urban và bộ lọc hãng xe

Trang chủ/API danh sách xe có thanh hãng ngay dưới header. Dữ liệu lấy từ xe thật và catalog hãng: chỉ hiện hãng có xe, sắp theo số lượng giảm dần; tối đa7hãng, phần còn lại trong Khác. Tất cả xe bỏ lọc; chọn hãng chuyển tới `/vehicles?brand=<brandId>` và kết hợp bộ lọc tên/trạng thái/loại/chỗ/hộp số hiện có. Không hardcode hãng hoặc gọi API khi chạy demo.

Thanh cao52px, chữ trắng, hover/selected có nền và gạch chân; nav có tên truy cập, aria-current và focus rõ. Màn hình hẹp cuộn ngang không xuống dòng. Thiếu dữ liệu hoặc lỗi API chỉ hiển thị Tất cả xe, không tạo hãng giả.

Nút phụ hero nền trắng, viền và bóng rõ; nút chính giữ màu cam. Header có trạng thái trang hiện tại. Nội dung hero và ảnh giữ nguyên; thẻ nội dung có nền/viền riêng. Font và bo góc dùng token hiện có.

## Design tokens
Mọi màu mới/shadow ở :root index.css, không inline màu trong component.
| Token/phần | Giá trị cuối |
| --- | --- |
| Page background | #F3EFE8, sáng hơn be cũ nhưng không nền trắng toàn trang |
| Surface/border | #FFFFFF / #E3DCD0; shadow0 1px 2px rgba(0,0,0,.04) |
| Brand bar/text | #963600 / #FFFFFF; height52px; hover trắng15%, selected trắng22%, underline trắng3px; focus trắng2px |
| Primary/hover/text accent | #FF7E33 / #E86B23 / #A24B1E (giữ cam/chữ hero); header hover/current dùng cam nâu text, underline cam2px và weight700 |
| Hero secondary | White, border1.5px #BFB3A3; shadow0 1px 2px black.08; hover bordercam/shadow0 3px 8px black.12; active translateY1px/shadow0 1px 1px black.06 |
| Hero primary | Shadow0 4px 12px rgba(255,127,50,.35); hover darker/translateY-1px; active translateY0/shadow0 2px 5px rgba(255,127,50,.2) |
| Transitions | Hero CTA150ms; reduced-motion rule hiện có giữ |
