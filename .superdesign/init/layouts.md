# Actual layout sources
## frontend\src\layouts\AdminLayout.jsx
```jsx
import { Outlet } from "react-router-dom";
import {
  Building2,
  Car,
  LayoutDashboard,
  MapPin,
  Star,
  Users,
} from "lucide-react";
import Sidebar from "../components/common/Sidebar";
import WorkspaceTopbar from "./WorkspaceTopbar";
import { DEMO_MODE } from "../demo/config";

const adminNav = [
  { to: "/admin/bookings", label: "Tra cứu đơn thuê", icon: Car },
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/accounts", label: "Quản lý tài khoản", icon: Users },
  { to: "/admin/vehicles", label: "Quản lý xe", icon: Car },
  { to: "/admin/catalog", label: "Danh mục xe", icon: Building2 },
  ...(!DEMO_MODE ? [{ to: "/admin/branches", label: "Chi nhánh / Tuyến", icon: Building2 }] : []),
  { to: "/admin/locations", label: "Điểm du lịch", icon: MapPin },
  { to: "/admin/reviews", label: "Kiểm duyệt đánh giá", icon: Star },
];

export default function AdminLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <WorkspaceTopbar areaLabel="Quản trị" />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <Sidebar title="Quản trị hệ thống" items={adminNav} />
        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

```

## frontend\src\layouts\GuestLayout.jsx
```jsx
import { Outlet } from "react-router-dom";
import Footer from "../components/common/Footer";
import Navbar from "../components/common/Navbar";

export default function GuestLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

```

## frontend\src\layouts\StaffLayout.jsx
```jsx
import { Outlet } from "react-router-dom";
import { Car, ClipboardList, Handshake, Inbox } from "lucide-react";
import Sidebar from "../components/common/Sidebar";
import WorkspaceTopbar from "./WorkspaceTopbar";

const staffNav = [
  { to: "/staff/queue", label: "Hàng đợi đơn duyệt", icon: Inbox },
  { to: "/staff/handover", label: "Bàn giao xe", icon: Handshake },
  { to: "/staff/return", label: "Nhận trả xe", icon: ClipboardList },
  { to: "/staff/fleet", label: "Trạng thái đội xe", icon: Car },
];

export default function StaffLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <WorkspaceTopbar areaLabel="Nhân viên" />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <Sidebar title="Vận hành" items={staffNav} />
        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

```

## frontend\src\layouts\UserLayout.jsx
```jsx
import { Outlet } from "react-router-dom";
import Footer from "../components/common/Footer";
import Navbar from "../components/common/Navbar";

export default function UserLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Navbar />
      <main className="mx-auto w-full max-w-6xl flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

```

## frontend\src\layouts\WorkspaceTopbar.jsx
```jsx
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Car, LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function WorkspaceTopbar({ areaLabel }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState("");

  const handleLogout = async () => {
    try {
      await logout();
      setLogoutError("");
      navigate("/login");
    } catch {
      setLogoutError("Chưa xác nhận được đăng xuất mọi phiên. Hãy thử lại.");
    }
  };

  return (
    <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2">
      {logoutError ? (
        <p role="alert" className="w-full text-sm text-rose-800">
          {logoutError}
        </p>
      ) : null}
      <Link
        to="/"
        className="flex items-center gap-2 text-sm font-semibold text-teal-800"
      >
        <Car className="h-5 w-5" />
        KDrive
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          {areaLabel}
        </span>
      </Link>
      <div className="flex items-center gap-3">
        <div className="hidden text-right text-sm sm:block">
          <p className="font-medium text-slate-800">{user?.fullName}</p>
          <p className="text-xs text-slate-500">{user?.role}</p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          <LogOut className="h-4 w-4" />
          Đăng xuất
        </button>
      </div>
    </header>
  );
}

```

## frontend\src\components\common\Navbar.jsx
```jsx
import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Car, ChevronDown, LogOut, Menu, UserRound, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { homePathForRole } from "../../utils/roles";
import { DEMO_MODE } from "../../demo/config";

const publicLinks = [
  { to: "/vehicles", label: "Duyệt xe" },
  ...(DEMO_MODE
    ? [
        { to: "/ai/recommend", label: "Gợi ý AI" },
        { to: "/ai/itinerary", label: "Lập lịch trình AI" },
      ]
    : []),
];

const userMenuLinks = [
  { to: "/user/bookings", label: "Đơn thuê của tôi" },
  { to: "/user/itineraries", label: "Lịch trình đã lưu" },
  { to: "/user/profile", label: "Thông tin cá nhân" },
];

function navClass({ isActive }) {
  return `rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? "bg-teal-50 text-teal-800"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
  }`;
}

export default function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  const handleLogout = async () => {
    setMenuOpen(false);
    setMobileOpen(false);
    try {
      await logout();
      setLogoutError("");
      navigate("/login");
    } catch {
      setLogoutError(
        "Chưa thể xác nhận đăng xuất mọi phiên. Vui lòng thử lại.",
      );
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      {logoutError ? (
        <p role="alert" className="bg-rose-50 px-4 py-2 text-sm text-rose-800">
          {logoutError}
        </p>
      ) : null}
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link
          to="/"
          className="flex items-center gap-2 font-semibold text-teal-800"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-700 text-white">
            <Car className="h-5 w-5" />
          </span>
          <span>
            KDrive
            <span className="ml-1 hidden text-xs font-normal text-slate-500 sm:inline">
              AI thuê xe tự lái
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {publicLinks.map((link) => (
            <NavLink key={link.to} to={link.to} className={navClass}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {isAuthenticated && user ? (
            <div className="relative hidden md:block">
              <button
                type="button"
                className="flex items-center gap-2 rounded-full border border-slate-200 py-1 pl-1 pr-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                aria-expanded={menuOpen}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setMenuOpen(false);
                }}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-100 text-teal-800">
                  <UserRound className="h-4 w-4" />
                </span>
                {user.fullName}
                <ChevronDown className="h-4 w-4 text-slate-400" />
              </button>
              {menuOpen ? (
                <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  <p className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
                    {user.email}
                  </p>
                  {user.role === "USER" ? (
                    userMenuLinks.map((link) => (
                      <Link
                        key={link.to}
                        to={link.to}
                        className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                        onClick={() => setMenuOpen(false)}
                      >
                        {link.label}
                      </Link>
                    ))
                  ) : (
                    <Link
                      to={homePathForRole(user.role)}
                      className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => setMenuOpen(false)}
                    >
                      Vào khu vực làm việc
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Đăng xuất
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="hidden items-center gap-2 md:flex">
              <Link
                to="/login"
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Đăng nhập
              </Link>
              <Link
                to="/register"
                className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800"
              >
                Đăng ký
              </Link>
            </div>
          )}

          <button
            type="button"
            className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 md:hidden"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label="Mở menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <div className="space-y-1 border-t border-slate-200 px-4 py-3 md:hidden">
          {publicLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={navClass}
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </NavLink>
          ))}
          {isAuthenticated && user?.role === "USER"
            ? userMenuLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </Link>
              ))
            : null}
          {isAuthenticated && user?.role !== "USER" ? (
            <Link
              className="block rounded-lg px-3 py-2 text-sm font-semibold text-teal-800"
              to={homePathForRole(user?.role)}
              onClick={() => setMobileOpen(false)}
            >
              Vào khu vực làm việc
            </Link>
          ) : null}
          {isAuthenticated ? (
            <button
              type="button"
              onClick={handleLogout}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
            >
              Đăng xuất
            </button>
          ) : (
            <div className="flex gap-2 pt-2">
              <Link
                to="/login"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-center text-sm"
              >
                Đăng nhập
              </Link>
              <Link
                to="/register"
                className="flex-1 rounded-lg bg-teal-700 px-3 py-2 text-center text-sm text-white"
              >
                Đăng ký
              </Link>
            </div>
          )}
        </div>
      ) : null}
    </header>
  );
}

```

## frontend\src\components\common\Footer.jsx
```jsx
import { Link } from "react-router-dom";
import { DEMO_MODE } from "../../demo/config";

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-900 text-slate-300">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          <p className="text-lg font-semibold text-white">KDrive</p>
          <p className="mt-2 text-sm leading-6">
            {DEMO_MODE
              ? "Hệ thống cho thuê xe tự lái với bản xem trước gợi ý xe và lập kế hoạch hành trình AI."
              : "Hệ thống cho thuê xe tự lái; giá, khả dụng và đơn thuê được xác nhận từ API."}
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
            {DEMO_MODE ? (
              <>
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
              </>
            ) : null}
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Lưu ý</p>
          <p className="mt-3 text-sm leading-6">
            {DEMO_MODE
              ? "Bản demo giữ các nghiệp vụ mẫu tách biệt với dữ liệu API."
              : "Chọn chi nhánh nhận/trả theo tuyến được cấu hình. Kiểm tra báo giá và thông tin đơn trước khi gửi yêu cầu."}
          </p>
        </div>
      </div>
      <div className="border-t border-slate-800 py-4 text-center text-xs text-slate-500">
        Đồ án tốt nghiệp · KDrive · {new Date().getFullYear()}
      </div>
    </footer>
  );
}

```