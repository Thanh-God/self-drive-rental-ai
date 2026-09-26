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
