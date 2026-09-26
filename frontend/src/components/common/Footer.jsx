import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-900 text-slate-300">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          <p className="text-lg font-semibold text-white">KDrive</p>
          <p className="mt-2 text-sm leading-6">
            Hệ thống cho thuê xe tự lái tích hợp AI hỗ trợ lựa chọn phương tiện
            và lập kế hoạch hành trình cá nhân hóa.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Khám phá</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link to="/vehicles" className="hover:text-white">
                Duyệt xe
              </Link>
            </li>
            <li>
              <Link to="/ai/recommend" className="hover:text-white">
                Gợi ý AI
              </Link>
            </li>
            <li>
              <Link to="/ai/itinerary" className="hover:text-white">
                Lập lịch trình AI
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Lưu ý</p>
          <p className="mt-3 text-sm leading-6">
            Nhận và trả xe tại cùng chi nhánh. Vui lòng kiểm tra khoảng thuê và
            thông tin đơn trước khi gửi yêu cầu.
          </p>
        </div>
      </div>
      <div className="border-t border-slate-800 py-4 text-center text-xs text-slate-500">
        Đồ án tốt nghiệp · KDrive · {new Date().getFullYear()}
      </div>
    </footer>
  );
}
