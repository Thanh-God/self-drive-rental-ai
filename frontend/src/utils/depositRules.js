// L6 (12/11/2026): cancellation and refund rules follow the deposit policy saved on each booking.
// Backend decides the refunds; these texts only explain the saved policy. Older bookings keep the Admin 0–100% decision.

export const DEPOSIT_POLICY_V2 = "demo-qr-manual-30-v2";

export function fixedCancellationRules(policy) {
  return policy === DEPOSIT_POLICY_V2;
}

/** Customer-facing rules for a booking with a deposit, in order. */
export function cancellationRules(policy) {
  const common = [
    "Hủy trước mốc nhận ít nhất 24 giờ (đơn theo ngày lấy đầu ngày nhận): hoàn toàn bộ cọc.",
    "Doanh nghiệp từ chối hoặc không giao được xe: hoàn toàn bộ cọc.",
  ];
  if (fixedCancellationRules(policy)) {
    return [
      ...common,
      "Hủy dưới 24 giờ trước mốc nhận (liên hệ nhân viên chi nhánh nhận): hoàn toàn bộ cọc.",
      "Không đến nhận xe và không báo trước khi hết ngày nhận: cọc giữ chỗ không được hoàn; khoản chuyển ngoài cọc (nếu có) được hoàn toàn bộ.",
    ];
  }
  return [...common, "Hủy dưới 24 giờ trước mốc nhận hoặc không đến nhận xe: quản trị viên quyết định mức hoàn 0–100%, có lý do."];
}

/** One sentence for the Staff no-show form. */
export function noShowDepositNote(policy) {
  return fixedCancellationRules(policy)
    ? " Cọc giữ chỗ đã áp dụng không được hoàn theo chính sách của đơn; khoản chuyển ngoài cọc (nếu có) được hoàn toàn bộ."
    : " Khoản cọc đã nhận (nếu có) được đưa vào yêu cầu hoàn chờ Admin quyết định 0–100%.";
}

/** Text for money recorded after the booking was cancelled or rejected. */
export function closedReceiptRule(policy) {
  return fixedCancellationRules(policy)
    ? "Khoản chuyển trước hoặc sau thời điểm hủy/từ chối đều chưa áp dụng vào cọc nên được hoàn toàn bộ."
    : "Khoản chuyển trước thời điểm hủy/từ chối được xử lý theo chính sách hủy của đơn (khách hủy sát giờ hoặc không đến nhận: Admin quyết định 0–100%). Khoản chuyển từ thời điểm đó trở đi được hoàn toàn bộ.";
}

/** Causes Staff/Admin choose when cancelling; `refund` states what follows for the booking's own policy ("" without deposit). */
export function cancellationCauses(booking) {
  const deposit = booking?.deposit?.required;
  const fixed = fixedCancellationRules(booking?.deposit?.policy);
  return [
    { value: "BUSINESS", label: "Doanh nghiệp không giao được xe", refund: deposit ? "Hoàn toàn bộ cọc cho khách." : "" },
    {
      value: "LATE_CUSTOMER",
      label: "Khách yêu cầu hủy",
      refund: !deposit ? "" : fixed
        ? "Hoàn toàn bộ cọc cho khách (hủy trước hay sát giờ đều hoàn đủ theo chính sách của đơn)."
        : "Hủy trước 24 giờ: hoàn toàn bộ cọc; sát giờ: Admin quyết định mức hoàn 0–100%.",
    },
  ];
}
