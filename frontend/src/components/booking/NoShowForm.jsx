import { useRef, useState } from "react";
import apiClient from "../../api/client";
import { Field, Notice } from "../common/PageKit";
import { getErrorMessage } from "../../utils/roles";
import { canRecordNoShow, pickupDayLabel } from "../../utils/pickupTiming";

/**
 * Staff chi nhánh nhận ghi nhận khách không đến nhận xe (POST /bookings/{id}/no-show).
 * Dùng chung cho đơn có cọc và không cọc; backend kiểm tra lại chi nhánh, ngày nhận, biên bản giao và version.
 * Không tự gửi lại khi lỗi: tải lại đơn để kiểm tra kết quả.
 */
export default function NoShowForm({ booking, role, assignedPickup, now, onDone, depositNote = false, standalone = false }) {
  const [contacted, setContacted] = useState(false);
  const [notDelivered, setNotDelivered] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  if (!canRecordNoShow(booking, { role, assignedPickup, now })) return null;

  async function submit(event) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await apiClient.post(`/bookings/${encodeURIComponent(booking.id)}/no-show`, {
        expectedVersion: booking.version, contacted, notDelivered, reason,
      });
      onDone?.();
    } catch (requestError) {
      setError(`${getErrorMessage(requestError, "Không ghi nhận được khách không đến nhận.")} Tải lại đơn để kiểm tra trước khi thử lại.`);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const form = (
    <form className="mt-4 space-y-2" aria-label="Ghi nhận khách không đến nhận" onSubmit={submit}>
      <p>Khách không đến nhận: chỉ xử lý sau hết ngày nhận ({pickupDayLabel(booking)}); nếu đã giao xe, chuyển xử lý ngoại lệ.</p>
      <p className="text-sm text-muted">
        Đơn sẽ chuyển sang Đã hủy (khách không đến nhận) và xe được trả lại lịch; thao tác không hoàn tác.
        {depositNote ? " Khoản cọc đã nhận (nếu có) được đưa vào yêu cầu hoàn chờ Admin quyết định 0–100%." : " Đơn này không có cọc nên không phát sinh hoàn tiền."}
      </p>
      <label className="block"><input type="checkbox" required checked={contacted} onChange={(e) => setContacted(e.target.checked)} /> Đã liên hệ khách</label>
      <label className="block"><input type="checkbox" required checked={notDelivered} onChange={(e) => setNotDelivered(e.target.checked)} /> Xe chưa thực sự được giao</label>
      <Field label="Lý do"><textarea required maxLength={1000} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {error ? <Notice error>{error}</Notice> : null}
      <button className="btn-secondary" disabled={busy}>{busy ? "Đang ghi nhận…" : "Ghi nhận khách không đến nhận"}</button>
    </form>
  );
  // Đơn không cọc không có khối cọc bao ngoài: tự đặt trong panel có tiêu đề.
  return standalone ? (
    <section className="panel mb-5" aria-label="Khách không đến nhận">
      <h2 className="text-lg font-semibold">Khách không đến nhận</h2>
      {form}
    </section>
  ) : form;
}
