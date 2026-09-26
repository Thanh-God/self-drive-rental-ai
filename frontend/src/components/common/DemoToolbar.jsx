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
