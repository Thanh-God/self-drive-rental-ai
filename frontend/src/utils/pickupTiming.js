import { vietnamDay } from "./bookingQueue.js";

const DAY_MS = 86400000;

/** Đã hết ngày nhận xe theo lịch Việt Nam (cùng mốc backend dùng cho no-show). Thiếu dữ liệu trả false. */
export function pickupDayPassed(booking, now) {
  const pickup = vietnamDay(booking?.startAt);
  const today = vietnamDay(now);
  return Boolean(pickup && today && today > pickup);
}

/** Còn dưới 24 giờ tới mốc nhận và chưa qua ngày nhận: khách không tự hủy, cần liên hệ nhân viên. */
export function nearPickup(booking, now) {
  const start = Date.parse(booking?.startAt);
  if (!Number.isFinite(start) || !Number.isFinite(Number(now))) return false;
  return start - Number(now) < DAY_MS && !pickupDayPassed(booking, now);
}

/** Ngày nhận dạng dd/mm/yyyy theo giờ Việt Nam; rỗng nếu thiếu dữ liệu. */
export function pickupDayLabel(booking) {
  const day = vietnamDay(booking?.startAt);
  if (!day) return "";
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

/** Staff chi nhánh nhận có thể ghi nhận khách không đến: đơn CONFIRMED và đã qua ngày nhận. Backend vẫn kiểm tra lại. */
export function canRecordNoShow(booking, { role, assignedPickup, now }) {
  return role === "STAFF" && Boolean(assignedPickup) && booking?.status === "CONFIRMED" && pickupDayPassed(booking, now);
}
