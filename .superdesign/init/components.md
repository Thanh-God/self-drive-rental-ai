# Shared components — React 19, custom primitives, Lucide, Tailwind 4
## frontend\src\components\common\Badge.jsx
```jsx
export default function Badge({ children, tone = "neutral", className = "" }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700",
    success: "bg-emerald-100 text-emerald-800",
    warning: "bg-amber-100 text-amber-800",
    danger: "bg-rose-100 text-rose-800",
    info: "bg-sky-100 text-sky-800",
    brand: "bg-teal-100 text-teal-800",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone] ?? tones.neutral} ${className}`}
    >
      {children}
    </span>
  );
}

```

## frontend\src\components\common\DemoToolbar.jsx
```jsx
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useDemo } from "../../context/DemoContext";
import { DEMO_MODE } from "../../demo/config";
import { homePathForRole } from "../../utils/roles";
export default function DemoToolbar() {
  const { user, selectDemoRole } = useAuth();
  const { scenario, setScenario, reset, storageError } = useDemo();
  const navigate = useNavigate();
  const location = useLocation();
  if (!DEMO_MODE) return null;
  return (
    <aside
      aria-label="Điều khiển bản demo"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-950"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
        <p>
          <strong>DEMO UI</strong> · Dữ liệu mẫu, thao tác chỉ lưu trong phiên
          trình duyệt. AI và giá là mô phỏng.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label>
            Vai trò{" "}
            <select
              aria-label="Vai trò"
              className="demo-select"
              value={user?.role || "GUEST"}
              onChange={(e) => {
                const role = e.target.value;
                selectDemoRole(role);
                setScenario("ready");
                navigate(role === "GUEST" ? "/" : homePathForRole(role));
              }}
            >
              <option value="GUEST">Guest</option>
              <option value="USER">User</option>
              <option value="STAFF">Staff</option>
              <option value="ADMIN">Admin</option>
            </select>
          </label>
          <label>
            Trạng thái{" "}
            <select
              aria-label="Trạng thái"
              className="demo-select"
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
            >
              <option value="ready">Có dữ liệu</option>
              <option value="loading">Loading</option>
              <option value="empty">Empty</option>
              <option value="error">Error</option>
            </select>
          </label>
          <button
            className="underline"
            onClick={() => {
              reset();
              navigate(
                location.pathname.startsWith("/user")
                  ? "/user/bookings"
                  : homePathForRole(user?.role),
              );
            }}
          >
            Khôi phục mẫu
          </button>
        </div>
      </div>
      {storageError ? <p role="status">{storageError}</p> : null}
    </aside>
  );
}

```

## frontend\src\components\common\EmptyState.jsx
```jsx
import { Inbox } from "lucide-react";

export default function EmptyState({
  icon: Icon = Inbox,
  title = "Chưa có dữ liệu",
  description = "Nội dung sẽ xuất hiện khi hệ thống có dữ liệu tương ứng.",
  action,
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
      <div className="mb-4 rounded-full bg-teal-50 p-3 text-teal-700">
        <Icon className="h-7 w-7" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-slate-500">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
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

## frontend\src\components\common\LoadingSkeleton.jsx
```jsx
export default function LoadingSkeleton({ rows = 4, className = "" }) {
  return (
    <div
      className={`animate-pulse space-y-3 ${className}`}
      aria-busy="true"
      aria-live="polite"
    >
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-xl border border-slate-200 bg-white p-4"
        >
          <div className="h-4 w-1/3 rounded bg-slate-200" />
          <div className="mt-3 h-3 w-full rounded bg-slate-100" />
          <div className="mt-2 h-3 w-2/3 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

```

## frontend\src\components\common\Modal.jsx
```jsx
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

export default function Modal({ open, title, children, onClose, footer }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const titleId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    const focusable = () => [
      ...dialogRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]',
      ),
    ];
    (focusable()[0] || dialogRef.current).focus();
    const onKey = (event) => {
      if (event.key === "Escape") closeRef.current?.();
      if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0],
          last = elements.at(-1);
        if (!first) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50"
        aria-label="Đóng hộp thoại"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl sm:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Đóng"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div>{children}</div>
        {footer ? (
          <div className="mt-6 flex justify-end gap-2">{footer}</div>
        ) : null}
      </div>
    </div>
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

## frontend\src\components\common\PageKit.jsx
```jsx
import { Link } from "react-router-dom";
import { cloneElement, useId } from "react";
import { useDemo } from "../../context/DemoContext";
import { DEMO_MODE } from "../../demo/config";
import EmptyState from "./EmptyState";
import LoadingSkeleton from "./LoadingSkeleton";
import Badge from "./Badge";
import { statusLabels } from "../../demo/model";
export const money = (value) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
export const dateTime = (value) =>
  value
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(new Date(value))
    : "—";
export const localInput = (days = 3) =>
  new Date(Date.now() + days * 86400000 + 7 * 3600000)
    .toISOString()
    .slice(0, 16);
export const toUTC = (value) => new Date(`${value}:00+07:00`).toISOString();
export function Page({ title, description, children, actions }) {
  return (
    <div className="page-shell">
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">KDRIVE / HÀNH TRÌNH CỦA BẠN</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              {description}
            </p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
export function Notice({ children, error = false }) {
  return (
    <div
      role={error ? "alert" : "status"}
      className={`notice ${error ? "notice-error" : ""}`}
    >
      {children}
    </div>
  );
}
export function Field({ label, children, hint }) {
  const id = useId();
  return (
    <label className="field">
      <span id={id}>{label}</span>
      {cloneElement(children, {
        "aria-labelledby": id,
        "aria-describedby": hint ? `${id}-hint` : undefined,
      })}
      {hint ? (
        <small id={`${id}-hint`} className="font-normal text-slate-500">
          {hint}
        </small>
      ) : null}
    </label>
  );
}
export function Status({ status }) {
  return (
    <Badge
      tone={
        status === "COMPLETED"
          ? "success"
          : ["CANCELLED", "REJECTED", "EXPIRED"].includes(status)
            ? "danger"
            : status === "PENDING"
              ? "warning"
              : "brand"
      }
    >
      {statusLabels[status] || status}
    </Badge>
  );
}
export function Missing({
  title = "Không tìm thấy dữ liệu",
  back = "/vehicles",
}) {
  return (
    <EmptyState
      title={title}
      description="Dữ liệu không tồn tại hoặc không thuộc quyền truy cập của bạn."
      action={
        <Link className="btn-secondary" to={back}>
          Quay lại danh sách
        </Link>
      }
    />
  );
}
export function DataGate({ children }) {
  const { scenario, setScenario } = useDemo();
  if (!DEMO_MODE)
    return (
      <Page title="Chức năng đang chờ kết nối">
        <Notice>
          Chế độ API đang bật. Màn hình nghiệp vụ này chưa có hợp đồng API được
          xác nhận; dữ liệu demo không được sử dụng.
        </Notice>
      </Page>
    );
  if (scenario === "loading")
    return (
      <Page title="Đang tải dữ liệu mẫu">
        <LoadingSkeleton />
        <button
          className="btn-secondary mt-4"
          onClick={() => setScenario("ready")}
        >
          Kết thúc mô phỏng tải
        </button>
      </Page>
    );
  if (scenario === "error")
    return (
      <Page title="Không thể tải dữ liệu">
        <Notice error>
          Lỗi kết nối mô phỏng. Dữ liệu mẫu đã lưu vẫn được giữ; biểu mẫu chưa
          lưu sẽ được đặt lại.
        </Notice>
        <button className="btn mt-4" onClick={() => setScenario("ready")}>
          Thử lại
        </button>
      </Page>
    );
  if (scenario === "empty")
    return (
      <Page title="Chưa có kết quả">
        <EmptyState
          description="Trạng thái rỗng để kiểm tra giao diện demo."
          action={
            <button className="btn" onClick={() => setScenario("ready")}>
              Xem dữ liệu mẫu
            </button>
          }
        />
      </Page>
    );
  return children;
}

```

## frontend\src\components\common\Sidebar.jsx
```jsx
import { NavLink } from "react-router-dom";

export default function Sidebar({ items, title }) {
  return (
    <aside className="w-full shrink-0 border-b border-slate-200 bg-slate-900 text-slate-200 lg:min-h-full lg:w-64 lg:border-b-0 lg:border-r lg:border-slate-800">
      <div className="px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-teal-300">
          {title}
        </p>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-6">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex min-w-max items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-teal-600 text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`
              }
            >
              {Icon ? <Icon className="h-4 w-4" /> : null}
              {item.label}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}

```

## frontend\src\components\vehicle\VehicleCard.jsx
```jsx
import { useState } from "react";
import { CarFront, Users, Gauge, Fuel, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { money } from "../common/PageKit";
import Badge from "../common/Badge";
import { getVehicleMedia } from "../../assets/images/vehicles";

export function VehicleVisual({
  vehicle,
  large = false,
  customSrc = null,
  alt = "",
}) {
  const [failedSrc, setFailedSrc] = useState(null);
  const media = vehicle?.noLocalAsset ? null : getVehicleMedia(vehicle);
  const imageSrc = customSrc || media?.main || vehicle?.image;

  if (imageSrc && failedSrc !== imageSrc) {
    return (
      <div
        className={`relative flex items-center justify-center overflow-hidden rounded-xl bg-slate-100 ${
          large ? "h-64 sm:h-96" : "h-52"
        }`}
      >
        <img
          src={imageSrc}
          alt={alt || vehicle?.name || "Ảnh xe"}
          className="h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
          onError={() => setFailedSrc(imageSrc)}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-900/50 via-slate-900/10 to-transparent opacity-70" />
        <div className="absolute top-3 left-3 flex gap-1.5">
          <span className="rounded-lg bg-teal-900/80 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-md">
            {vehicle?.category || "Sedan"}
          </span>
        </div>
        <div className="absolute bottom-2.5 right-3">
          <span className="rounded bg-black/60 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-slate-200 backdrop-blur-sm">
            {vehicle?.plate || "DEMO"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-teal-50 via-slate-50 to-slate-200 ${
        large ? "h-64 sm:h-96" : "h-52"
      }`}
    >
      <div className="absolute bottom-6 h-3 w-36 rounded-[100%] bg-slate-300/40 blur-md" />
      <CarFront
        aria-hidden="true"
        strokeWidth={1}
        style={{ color: vehicle?.color || "#0f766e" }}
        className={large ? "h-40 w-64" : "h-28 w-44"}
      />
      <span className="absolute bottom-3 right-3 text-[10px] uppercase tracking-widest text-slate-500">
        {vehicle?.noLocalAsset ? "Ảnh chưa cập nhật" : "Minh họa · Demo"}
      </span>
    </div>
  );
}

export default function VehicleCard({ vehicle, search = "", rentalDays = 0 }) {
  const isAvailable = vehicle.status === "ACTIVE";
  const totalPrice = rentalDays > 0 ? vehicle.price * rentalDays : 0;

  return (
    <article className="group flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition-[transform,box-shadow,border-color] duration-200 motion-reduce:transition-none motion-reduce:hover:translate-y-0 hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md">
      <div>
        <Link to={`/vehicles/${vehicle.id}${search}`} className="block">
          <VehicleVisual vehicle={vehicle} />
        </Link>
        <div className="p-2 pt-4">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">
              {vehicle.brand}
            </span>
            {isAvailable ? (
              <Badge tone="success">{vehicle.noLocalAsset ? "Đang khai thác" : "Sẵn sàng"}</Badge>
            ) : (
              <Badge tone="warning">
                {vehicle.status === "MAINTENANCE"
                  ? "Bảo trì"
                  : "Ngừng khai thác"}
              </Badge>
            )}
          </div>
          <h2 className="text-lg font-bold text-slate-900 transition-colors group-hover:text-teal-700">
            <Link to={`/vehicles/${vehicle.id}${search}`}>{vehicle.name}</Link>
          </h2>

          <div className="my-3.5 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2 text-xs font-medium text-slate-600">
            <div className="flex items-center gap-1.5 justify-center">
              <Users size={14} className="text-teal-700" />
              <span>{vehicle.seats} chỗ</span>
            </div>
            <div className="flex items-center gap-1.5 justify-center border-x border-slate-200 px-1">
              <Gauge size={14} className="text-teal-700" />
              <span className="truncate">{vehicle.transmission}</span>
            </div>
            <div className="flex items-center gap-1.5 justify-center">
              <Fuel size={14} className="text-teal-700" />
              <span>{vehicle.fuel}</span>
            </div>
          </div>

          {vehicle.amenities && vehicle.amenities.length > 0 ? (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {vehicle.amenities.slice(0, 3).map((a) => (
                <span
                  key={typeof a === "object" ? a.id : a}
                  className="inline-flex items-center gap-1 rounded-md bg-teal-50/70 px-2 py-0.5 text-[11px] font-medium text-teal-800"
                >
                  <Check size={11} className="text-teal-600" />
                  {typeof a === "object" ? a.name : a}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-slate-100 p-2 pt-3.5">
        <div>
          <div className="flex items-baseline gap-1">
            <strong className="text-lg font-bold text-teal-800">
              {money(vehicle.price)}
            </strong>
            <span className="text-xs text-slate-500">/ 24 giờ</span>
          </div>
          {rentalDays > 0 ? (
            <p className="text-[11px] font-medium text-teal-700">
              Ước tính: {money(totalPrice)} ({rentalDays} ngày)
            </p>
          ) : (
            <p className="text-[11px] text-slate-400">
              {vehicle.noLocalAsset ? "Giá niêm yết từ hệ thống" : "Giá mẫu niêm yết"}
            </p>
          )}
        </div>
        <Link
          className="btn-secondary text-xs font-semibold hover:border-teal-600 hover:text-teal-800"
          to={`/vehicles/${vehicle.id}${search}`}
        >
          Xem chi tiết ↗
        </Link>
      </div>
    </article>
  );
}

```