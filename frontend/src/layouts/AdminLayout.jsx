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

const adminNav = [
  { to: "/admin/bookings", label: "Tra cứu đơn thuê", icon: Car },
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/accounts", label: "Quản lý tài khoản", icon: Users },
  { to: "/admin/vehicles", label: "Quản lý xe", icon: Car },
  { to: "/admin/catalog", label: "Danh mục / Chi nhánh", icon: Building2 },
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
