import { useRef, useState } from "react";
import { getBooking, recordRentalBalance, refundRentalBalance, reverseRentalBalance } from "../../api/rental";
import { getErrorMessage } from "../../utils/roles";
import { Field, Notice, money, dateTime } from "../common/PageKit";

export const rentalBalanceStatusLabels = { DUE: "Chưa ghi nhận", RECORDED: "Đã ghi nhận", NOT_DUE: "Không còn phải thu", REFUND_DUE: "Cần hoàn cho khách", REFUNDED: "Đã hoàn cho khách" };
const methodLabels = { CASH: "Tiền mặt", BANK_TRANSFER: "Chuyển khoản" };
const kindLabels = { RECORDED: "Ghi nhận", REVERSED: "Đảo bản ghi", REFUND_DUE: "Đơn hủy — cần hoàn", REFUNDED: "Đã hoàn" };
const CLOSED = ["CANCELLED", "REJECTED"];
const WRITABLE = ["CONFIRMED", "IN_PROGRESS", "RETURNED"];

/** Whether handover must wait for the remaining rent (backend rejects it anyway; the UI says so before Staff tries). */
export function rentalBalanceBlocksHandover(booking) {
  return booking?.rentalBalance?.status === "DUE";
}

function newKey() {
  return globalThis.crypto?.randomUUID?.() ?? `rb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * L4 (Q1/Q2): remaining rent = total − deposit, recorded once by pickup-branch Staff before handover;
 * Admin reverses a wrong record with a reason. DEMO only, never real money; an invoice does not prove payment.
 */
export default function RentalBalance({ booking, role, assignedPickup, onSaved }) {
  const balance = booking?.rentalBalance;
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unknown, setUnknown] = useState(null);
  const pendingKey = useRef(null);
  const inFlight = useRef(false);
  if (!balance) return null;
  // L9: a closed booking with nothing received has nothing to show; one with money received shows the refund.
  const refund = balance.refund;
  if (CLOSED.includes(booking.status) && !refund) return null;

  const isUser = role === "USER";
  const canRecord = role === "STAFF" && assignedPickup && balance.status === "DUE" && WRITABLE.includes(booking.status);
  const canReverse = role === "ADMIN" && balance.status === "RECORDED" && WRITABLE.includes(booking.status);
  const canRefund = role === "ADMIN" && refund?.status === "REFUND_DUE" && booking.status === "CANCELLED";

  async function send(kind, body, matches) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    // Keep the same key until the server has answered, so a retry after a lost reply cannot write twice.
    if (!pendingKey.current) pendingKey.current = newKey();
    const input = { ...body, idempotencyKey: pendingKey.current, expectedVersion: booking.version, confirmed: true };
    try {
      await ({ record: recordRentalBalance, reverse: reverseRentalBalance, refund: refundRentalBalance }[kind])(booking.id, input);
      pendingKey.current = null;
      setUnknown(null);
      onSaved?.();
    } catch (requestError) {
      const status = requestError?.response?.status;
      if (status >= 400 && status < 500) {
        pendingKey.current = null;
        setError(getErrorMessage(requestError, "Không ghi nhận được. Tải lại đơn để kiểm tra."));
      } else {
        // Outcome unknown: read the booking back instead of sending a new record.
        setUnknown(kind);
        try {
          const detail = await getBooking(booking.id);
          if (matches(detail?.booking?.rentalBalance)) { pendingKey.current = null; setUnknown(null); onSaved?.(); return; }
          setError("Chưa xác minh được kết quả. Bấm Thử lại để gửi lại đúng thao tác này (không tạo bản ghi thứ hai), hoặc tải lại đơn.");
        } catch {
          setError("Chưa xác minh được kết quả và chưa tải lại được đơn. Kiểm tra kết nối rồi tải lại đơn trước khi thao tác tiếp.");
        }
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function submitRecord(event) {
    event.preventDefault();
    const ref = reference.trim();
    if (method === "BANK_TRANSFER" && !ref) { setError("Chuyển khoản cần mã tham chiếu giao dịch."); return; }
    send("record", { amountVnd: balance.dueAmount, method, reference: ref || null },
      (next) => next?.status === "RECORDED" && next.recorded?.amount === balance.dueAmount && next.recorded?.method === method);
  }

  function submitRefund(event) {
    event.preventDefault();
    const ref = reference.trim();
    if (method === "BANK_TRANSFER" && !ref) { setError("Chuyển khoản hoàn cần mã tham chiếu giao dịch."); return; }
    send("refund", { amountVnd: refund.amount, method, reference: ref || null },
      (next) => next?.refund?.status === "REFUNDED" && next.refund.amount === refund.amount && next.refund.method === method);
  }

  function submitReverse(event) {
    event.preventDefault();
    const why = reason.trim();
    if (!why) { setError("Nhập lý do đảo bản ghi."); return; }
    send("reverse", { reason: why }, (next) => next?.status === "DUE");
  }

  const recorded = balance.recorded;
  return (
    <section className="panel mb-5 space-y-3" aria-label="Phần tiền thuê còn lại">
      <h2 className="text-lg font-semibold">Phần tiền thuê còn lại — {rentalBalanceStatusLabels[balance.status] || "Chưa xác định"}</h2>
      {balance.demo ? <Notice>Mô phỏng — Không chuyển tiền thật. Ghi nhận dưới đây là DEMO.</Notice> : null}
      <p>
        {balance.status === "DUE" ? "Còn lại cần thanh toán" : "Phần tiền thuê còn lại sau cọc"}: <strong>{money(balance.dueAmount)}</strong>
        {booking.deposit?.required ? ` (tổng ${money(booking.total)} trừ cọc ${money(booking.deposit.amount)} đã tính vào tiền thuê).` : ` (toàn bộ tổng ${money(booking.total)}; đơn không có cọc).`}
      </p>
      {refund ? (
        <Notice>
          {refund.status === "REFUNDED"
            ? `Đơn đã hủy: đã hoàn ${money(refund.amount)} tiền thuê đã thanh toán · ${methodLabels[refund.method] || refund.method}${refund.reference ? ` · Tham chiếu ${refund.reference}` : ""} · ${dateTime(refund.refundedAt)}.`
            : `Đơn đã hủy: khoản tiền thuê đã thanh toán ${money(refund.amount)} được hoàn toàn bộ${isUser ? "; quản trị viên ghi nhận khi đã hoàn." : "; chờ quản trị viên ghi nhận đã hoàn."}`}
        </Notice>
      ) : null}
      {balance.status === "DUE" ? (
        <p>{isUser ? "Thanh toán khoản này tại chi nhánh nhận trước khi nhận xe; nhân viên ghi nhận trước khi giao xe." : "Ghi nhận đủ khoản này một lần trước khi giao xe."}</p>
      ) : null}
      {recorded ? (
        <p>
          Đã ghi nhận {money(recorded.amount)} · {methodLabels[recorded.method] || recorded.method}
          {recorded.reference ? ` · Tham chiếu ${recorded.reference}` : ""} · {dateTime(recorded.recordedAt)}
          {balance.recordedByName ? ` · ${balance.recordedByName}` : ""}
        </p>
      ) : null}
      <p className="text-sm text-muted">Ghi nhận chỉ phản ánh việc nhân viên xác nhận đã thu; hóa đơn không chứng minh đã thanh toán.</p>

      {Array.isArray(balance.history) && balance.history.length ? (
        <details>
          <summary>Nhật ký ghi nhận ({balance.history.length})</summary>
          <ul className="mt-2 space-y-2 text-sm">
            {balance.history.map((item, index) => (
              <li key={`${item.kind}-${item.at}-${index}`} className="border-t pt-2">
                <strong>{kindLabels[item.kind] || item.kind}: {money(item.amount)}</strong> · {methodLabels[item.method] || item.method}
                {item.reference ? ` · ${item.reference}` : ""}
                <p>{item.actorName} · {dateTime(item.at)}</p>
                {item.reason ? <p>Lý do: {item.reason}</p> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {canRecord ? (
        <form className="space-y-3 border-t pt-3" aria-label="Ghi nhận phần tiền thuê còn lại" onSubmit={submitRecord}>
          <p>Số tiền ghi nhận: <strong>{money(balance.dueAmount)}</strong> (đúng bằng phần còn lại, ghi nhận một lần).</p>
          <Field label="Phương thức thu">
            <select value={method} disabled={busy || Boolean(unknown)} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">Tiền mặt</option>
              <option value="BANK_TRANSFER">Chuyển khoản đã đối chiếu</option>
            </select>
          </Field>
          <Field label={method === "BANK_TRANSFER" ? "Mã tham chiếu giao dịch (bắt buộc)" : "Số phiếu thu (không bắt buộc)"}>
            <input value={reference} maxLength={120} disabled={busy || Boolean(unknown)} required={method === "BANK_TRANSFER"} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" required checked={checked} disabled={busy || Boolean(unknown)} onChange={(e) => setChecked(e.target.checked)} />
            Tôi đã thu và đối chiếu đủ {money(balance.dueAmount)} với khách.
          </label>
          <button className="btn" disabled={busy || !checked}>{busy ? "Đang ghi nhận…" : unknown ? "Thử lại" : "Ghi nhận đã thu"}</button>
        </form>
      ) : null}

      {canRefund ? (
        <form className="space-y-3 border-t pt-3" aria-label="Ghi nhận hoàn tiền thuê" onSubmit={submitRefund}>
          <p>Số tiền hoàn: <strong>{money(refund.amount)}</strong> (toàn bộ khoản đã ghi nhận, ghi một lần).</p>
          <Field label="Phương thức hoàn">
            <select value={method} disabled={busy || Boolean(unknown)} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">Tiền mặt</option>
              <option value="BANK_TRANSFER">Chuyển khoản</option>
            </select>
          </Field>
          <Field label={method === "BANK_TRANSFER" ? "Mã tham chiếu giao dịch (bắt buộc)" : "Số phiếu chi (không bắt buộc)"}>
            <input value={reference} maxLength={120} disabled={busy || Boolean(unknown)} required={method === "BANK_TRANSFER"} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" required checked={checked} disabled={busy || Boolean(unknown)} onChange={(e) => setChecked(e.target.checked)} />
            Tôi đã hoàn đủ {money(refund.amount)} cho khách.
          </label>
          <button className="btn" disabled={busy || !checked}>{busy ? "Đang ghi nhận…" : unknown ? "Thử lại" : "Ghi nhận đã hoàn"}</button>
        </form>
      ) : null}

      {canReverse ? (
        <form className="space-y-3 border-t pt-3" aria-label="Đảo bản ghi phần tiền thuê còn lại" onSubmit={submitReverse}>
          <p>Đảo toàn bộ bản ghi hiện hành khi ghi sai; nhân viên chi nhánh nhận ghi nhận lại bản đúng. Không tự hoàn tiền.</p>
          <Field label="Lý do đảo"><textarea required maxLength={1000} rows={2} value={reason} disabled={busy || Boolean(unknown)} onChange={(e) => setReason(e.target.value)} /></Field>
          <button className="btn-secondary" disabled={busy}>{busy ? "Đang đảo…" : unknown ? "Thử lại" : "Đảo bản ghi"}</button>
        </form>
      ) : null}
      {error ? <Notice error>{error}</Notice> : null}
    </section>
  );
}
