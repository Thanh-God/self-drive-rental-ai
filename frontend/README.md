# KDrive — UI/UX Giai đoạn 4

Frontend React/Vite được phát triển tiếp từ giao diện KDrive có sẵn. Giữ layout Guest/User/Staff/Admin, màu teal/slate, Navbar/Sidebar/Footer và route guard. Không triển khai backend, database hoặc API AI trong giai đoạn này.

## Chạy local

Trong thư mục `frontend`, chạy `npm ci` nếu chưa có dependency, sau đó `npm run dev -- --host 127.0.0.1`. Mở địa chỉ Vite thông báo (mặc định http://127.0.0.1:5173). `npm run build` kiểm tra bản build; `npm test` chạy các ca biên của mô phỏng demo bằng Node test runner, không cần thư viện test mới.

## Hai chế độ dữ liệu

- `VITE_DATA_MODE=demo` là mặc định của bản UI này. Thanh **DEMO UI** luôn hiển thị; chọn Guest/User/Staff/Admin để kiểm tra từng khu vực. Không nhập tài khoản thật hoặc mật khẩu trong demo. Không gọi API backend, Gemini hoặc Map.
- Dữ liệu demo lưu trong `sessionStorage` với khóa `kdrive.demo.data.v1`, vai trò lưu riêng tại `kdrive.demo.role`. Reload cùng tab giữ dữ liệu; nút **Khôi phục mẫu** đặt lại tập dữ liệu demo. Không đọc/ghi token thật để mô phỏng đăng nhập. Các vai trò mẫu độc lập với tài khoản thêm/sửa trong màn hình Admin.
- `VITE_DATA_MODE=api` tắt toàn bộ nguồn demo và bộ chọn vai trò. Giữ form auth/API client sẵn có; các màn hình nghiệp vụ hiển thị đang chờ kết nối vì DTO/endpoint chưa được backend xác nhận. Không tự thay lỗi API bằng dữ liệu giả. Sau khi đổi biến môi trường cần khởi động lại Vite.
- `.env.example` chỉ là mẫu cấu hình. Vite dùng `.env.local` khi bạn tạo file đó; tuyệt đối không đặt Gemini/Map secret trong biến `VITE_*`.

## Luồng demo

1. Guest mở Duyệt xe, tìm/lọc và xem chi tiết. Chọn đặt xe sẽ sang đăng nhập demo, chọn User rồi quay về xe/thời gian đang chọn.
2. Nhập khoảng thuê, kiểm tra lịch/giá mẫu, xác nhận rồi gửi đơn. Đơn dùng block 24 giờ làm tròn lên và hạn chờ nhỏ hơn giữa 2 giờ và giờ nhận. Cọc/phụ phí không được suy diễn thành giá trị 0 hay cộng vào tiền thuê.
3. Đổi Staff, mở mã đơn vừa tạo, xác nhận, xem hợp đồng mẫu, lập biên bản giao (có kiểm tra GPLX), nhận trả, rồi hoàn tất và xem hóa đơn. Demo cho thử các bước liên tiếp để review UI; điều kiện giao sớm, trả muộn, gia hạn, no-show chưa được triển khai.
4. Đổi User, mở đơn hoàn tất, gửi một đánh giá. Đổi Admin để thử ẩn/hiện; xem lại trang xe để kiểm tra đánh giá công khai.
5. Recommendation lọc/chấm điểm minh họa từ tiêu chí có cấu trúc; không xử lý free text bằng AI. Thử lỗi giải thích: giữ danh sách; lỗi hiểu yêu cầu: yêu cầu thử lại.
6. Itinerary dùng tập địa điểm Đà Nẵng/Hội An và số liệu tuyến gắn nhãn **demo**. Số người/ngân sách lưu làm tiêu chí, chưa tối ưu; các ngày lặp lại điểm để minh họa layout. Đây không phải kết quả đã kiểm chứng bằng Map. Thử lỗi thiếu tuyến/AI: không có kết quả để lưu. Chỉ User lưu bản mẫu và xem lại trong hành trình của mình.

## Routing

| Khu vực        | URL                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Công khai      | `/`, `/vehicles`, `/vehicles/:vehicleId`, `/login`, `/register`                                                                                            |
| AI preview     | `/ai/recommend`, `/ai/itinerary` — Guest chỉ xem mô phỏng UI; chính sách AI thật vẫn mở                                                                    |
| User           | `/user/bookings`, `/user/bookings/new?vehicleId=…`, `/user/bookings/:bookingId`, `/user/profile`                                                           |
| User itinerary | `/user/itineraries`, `/user/itineraries/:itineraryId`                                                                                                      |
| Staff          | `/staff/queue`, `/staff/bookings/:bookingId`, `/staff/handover`, `/staff/handover/:bookingId`, `/staff/return`, `/staff/return/:bookingId`, `/staff/fleet` |
| Admin          | `/admin`, `/admin/accounts`, `/admin/vehicles`, `/admin/catalog`, `/admin/locations`, `/admin/reviews`, `/admin/bookings`, `/admin/bookings/:bookingId`    |
| Hồ sơ          | `/{user,staff,admin}/bookings/:bookingId/contract` hoặc `/invoice`                                                                                         |
| Lỗi            | `/unauthorized`, route không tồn tại và tài nguyên không tìm thấy                                                                                          |

Guard tách role; Admin không vào Staff/User. Route guard và mô phỏng quyền chỉ phục vụ UI, không là cơ chế bảo mật backend. Với triển khai SPA, host phải phục vụ `index.html` cho các URL route khi reload.

## Cấu trúc và giới hạn

- `src/demo`: seed và mô phỏng chuyển trạng thái/khả dụng/giá, chỉ phục vụ review UI. Không copy làm nguồn nghiệp vụ có thẩm quyền.
- `src/context/DemoContext.jsx`: dữ liệu phiên demo; `AuthContext.jsx`: tách phiên demo và phiên API.
- `src/components/common/PageKit.jsx`: bố cục, field, thông báo, loading/empty/error gate; toolbar chọn tình huống demo. Đổi tình huống sẽ đặt lại biểu mẫu chưa lưu, dữ liệu đã lưu vẫn giữ.
- Màn hình theo nhóm `VehicleScreens`, `BookingScreens`, `AiScreens`, `ManagementScreens`; các page cũ được giữ làm entrypoint để giữ cấu trúc quen thuộc.
- Hình xe là icon minh họa có nhãn, chưa phải ảnh catalog thật. Hồ sơ có form đổi mật khẩu để thử validation bằng giá trị mẫu, không lưu/gửi mật khẩu. Ảnh nhiều góc, upload ảnh, đổi mật khẩu thật, API auth tích hợp, map tương tác và thao tác phát hành lại chưa được triển khai.
- Chưa bổ sung xóa cứng dữ liệu giao dịch, thanh toán online, trình chỉnh sửa itinerary hoặc quyền Admin giao nhận.
- Các thông số còn mở theo `docs/database/database-design.md` và `docs/architecture/decisions.md`. Tài liệu Giai đoạn 3 không bị sửa trong công việc UI.

## Kiểm tra thủ công sau khi thay đổi

- Guest vào route bảo vệ → login và giữ query; sai role → unauthorized; đường dẫn sai → 404.
- Tạo đơn trùng lịch → thông báo lỗi; đơn hết hạn không xác nhận được; thao tác dùng version cũ bị từ chối trong demo.
- Hợp đồng xuất hiện sau xác nhận, hóa đơn sau hoàn tất; giá catalog sửa không làm đổi snapshot đơn/hồ sơ cũ.
- Modal giữ focus, Escape đóng và trả focus về nút mở. Kiểm tra mobile 390px và desktop 1440px.
- Loading/empty/error qua toolbar, trạng thái rỗng do bộ lọc, lỗi AI, tài nguyên không tồn tại; kiểm tra console không có lỗi.
- Kết quả demo không chứng minh transaction chống đặt trùng, phân quyền server hoặc AI/Map đã hoạt động. Các phần này cần kiểm thử tích hợp riêng khi backend sẵn sàng.
