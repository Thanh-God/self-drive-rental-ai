// L3: one place that tells the renter what is paid, what remains and where. Reads API fields only; the backend
// owns every amount. Deposit is part of the rent; the remaining rent is recorded by Staff before handover (L4)
// only for bookings created under that policy. Nothing here proves real payment.

const OPEN = ["PENDING", "CONFIRMED", "IN_PROGRESS", "RETURNED", "COMPLETED"];

export function paymentSchedule(booking) {
  if (!booking || !OPEN.includes(booking.status)) return null;
  const total = Number(booking.total) || 0;
  const deposit = booking.deposit || {};
  const depositAmount = deposit.required ? Number(deposit.amount) || 0 : 0;
  const applied = Number(deposit.appliedAmount) || 0;

  let depositRow;
  if (!deposit.required) depositRow = { state: "NONE", label: "Không yêu cầu cọc giữ chỗ", amount: 0 };
  else if (applied >= depositAmount && depositAmount > 0) depositRow = { state: "APPLIED", label: "Đã ghi nhận vào đơn", amount: depositAmount };
  else if (booking.status === "PENDING") depositRow = { state: "PENDING", label: deposit.approvedAt ? "Chờ đóng cọc trong hạn hiển thị ở phần cọc" : "Đóng sau khi nhân viên kiểm tra hồ sơ", amount: depositAmount };
  else depositRow = { state: "CHECK", label: "Chưa ghi nhận đủ; xem phần cọc giữ chỗ", amount: depositAmount };

  const balance = booking.rentalBalance;
  let remainderRow;
  if (balance) {
    const amount = Number(balance.dueAmount) || 0;
    if (balance.status === "RECORDED") remainderRow = { state: "RECORDED", label: "Nhân viên đã ghi nhận đã thu", amount };
    else if (balance.status === "NOT_DUE") remainderRow = { state: "NOT_DUE", label: "Không còn khoản phải thu", amount };
    else remainderRow = { state: "DUE", label: "Thanh toán tại chi nhánh nhận trước khi nhận xe", amount };
  } else {
    remainderRow = {
      state: "UNTRACKED",
      label: "Hệ thống không ghi nhận khoản này cho đơn này; liên hệ chi nhánh nhận về cách thanh toán",
      amount: Math.max(0, total - depositAmount),
    };
  }
  return { total, deposit: depositRow, remainder: remainderRow, demo: Boolean(balance?.demo) || depositRow.state !== "NONE" };
}

/** One sentence for the quote about the remaining rent (no deposit wording, so a no-deposit quote mentions "cọc" once). */
export function quoteRemainderSentence(quote, money) {
  if (!quote) return "";
  const balance = quote.rentalBalance;
  if (balance && Number(balance.dueAmount) > 0)
    return `Phần còn lại ${money(balance.dueAmount)} thanh toán tại chi nhánh nhận trước khi nhận xe; nhân viên ghi nhận trước khi giao xe.`;
  return "Phần còn lại thanh toán tại chi nhánh nhận theo hướng dẫn của nhân viên; hệ thống không ghi nhận khoản này cho báo giá này.";
}
