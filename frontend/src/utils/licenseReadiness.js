// Điều kiện GPLX hiển thị trên trang đặt xe. Backend vẫn là nơi quyết định:
// tạo đơn cần đủ ảnh hai mặt (chưa cần duyệt); xác nhận/giao xe cần ảnh đạt kiểm tra.

const BOOKING_PATH = "/user/bookings/new";
const MAX_RETURN_TO = 600;

/**
 * Trạng thái GPLX cho người thuê.
 * canSubmit=false chỉ khi chắc chắn backend sẽ từ chối tạo đơn (chưa khai báo/thiếu ảnh)
 * hoặc đang tải hồ sơ. Lỗi tải hồ sơ không khóa gửi: không suy luận khi thiếu dữ liệu.
 */
export function licenseReadiness({ loading = false, error = "", license = null } = {}) {
  if (loading) {
    return { state: "LOADING", canSubmit: false, tone: "info", title: "Đang kiểm tra hồ sơ GPLX…", detail: "", blockReason: "Đang kiểm tra hồ sơ GPLX." };
  }
  if (error) {
    return {
      state: "ERROR", canSubmit: true, tone: "warning",
      title: "Chưa tải được hồ sơ GPLX",
      detail: "Không xác định được trạng thái ảnh GPLX. Hệ thống vẫn kiểm tra khi bạn gửi yêu cầu.",
      blockReason: "",
    };
  }
  if (!license || typeof license !== "object" || !license.id) {
    return {
      state: "NO_LICENSE", canSubmit: false, tone: "error",
      title: "Chưa khai báo giấy phép lái xe",
      detail: "Khai báo GPLX và tải đủ hai mặt ảnh trong Hồ sơ & GPLX trước khi gửi yêu cầu thuê.",
      action: "Khai báo GPLX",
      blockReason: "Cần khai báo GPLX và tải đủ hai mặt ảnh trước khi gửi.",
    };
  }
  const photos = license.photos || {};
  if (!photos.front || !photos.back) {
    return {
      state: "MISSING_PHOTOS", canSubmit: false, tone: "error",
      title: "GPLX còn thiếu ảnh hai mặt",
      detail: "Cần tải đủ ảnh mặt trước và mặt sau trước khi gửi yêu cầu thuê. Bạn vẫn có thể xem báo giá.",
      action: "Bổ sung ảnh GPLX",
      blockReason: "Cần tải đủ hai mặt ảnh GPLX trước khi gửi.",
    };
  }
  if (photos.status === "NEEDS_CHANGES") {
    return {
      state: "NEEDS_CHANGES", canSubmit: true, tone: "warning",
      title: "Nhân viên yêu cầu bổ sung ảnh GPLX",
      detail: `${photos.reason ? `Nhận xét: ${photos.reason}. ` : ""}Bạn vẫn gửi được yêu cầu, nhưng cần thay ảnh trước khi đơn được xác nhận.`,
      action: "Thay ảnh GPLX",
      blockReason: "",
    };
  }
  if (photos.status === "APPROVED") {
    return {
      state: "APPROVED", canSubmit: true, tone: "success",
      title: "GPLX: đủ ảnh hai mặt, đạt kiểm tra hồ sơ",
      detail: "Nhân viên vẫn đối chiếu bản gốc khi giao xe.",
      blockReason: "",
    };
  }
  return {
    state: "PENDING_REVIEW", canSubmit: true, tone: "success",
    title: "GPLX: đã đủ ảnh hai mặt",
    detail: "Nhân viên chi nhánh nhận kiểm tra ảnh sau khi bạn gửi yêu cầu, rồi đối chiếu bản gốc khi giao xe.",
    blockReason: "",
  };
}

/** Đường quay lại trang đặt xe với đúng xe, ngày và chi nhánh đang chọn. */
export function bookingReturnPath(params, { vehicleId, start, end, pickupBranchId, returnBranchId }) {
  const next = new URLSearchParams(params);
  const fields = { vehicleId, start, end, pickupBranchId, returnBranchId };
  for (const [key, value] of Object.entries(fields)) {
    if (value) next.set(key, value); else next.delete(key);
  }
  return `${BOOKING_PATH}?${next.toString()}`;
}

/**
 * Chỉ nhận đường nội bộ tới trang đặt xe; mọi giá trị khác trả null.
 * Chặn URL tuyệt đối, protocol-relative (//), dấu \ và ký tự điều khiển.
 */
export function safeReturnTo(value) {
  if (typeof value !== "string" || !value || value.length > MAX_RETURN_TO) return null;
  if (!value.startsWith(`${BOOKING_PATH}?`)) return null;
  if (value.includes("\\") || value.includes("//")) return null;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return null;
  }
  let parsed;
  try {
    parsed = new globalThis.URL(value, "http://kdrive.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "http://kdrive.invalid" || parsed.pathname !== BOOKING_PATH) return null;
  if (!parsed.searchParams.get("vehicleId")) return null;
  return `${parsed.pathname}${parsed.search}`;
}

export function profilePathWithReturn(returnPath) {
  const safe = safeReturnTo(returnPath);
  return safe ? `/user/profile?returnTo=${encodeURIComponent(safe)}` : "/user/profile";
}
