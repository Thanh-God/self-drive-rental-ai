import { useRef, useState } from "react";
import apiClient from "../../api/client";
import { dateTime, Notice } from "../common/PageKit";
import { getErrorMessage } from "../../utils/roles";

/**
 * L8: footer of a contract that needs the customer's acceptance. The booking's own customer ticks and presses "Đồng ý"
 * while the booking is confirmed; everyone else sees whether it has been accepted.
 */
export default function ContractAcceptance({ bookingId, acceptance, canAccept, onAccepted }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  if (acceptance.acceptedAt) {
    return (
      <p className="mt-5 text-sm font-medium text-teal-800" data-testid="contract-accepted">
        Bên thuê đã đồng ý hợp đồng trên hệ thống lúc {dateTime(acceptance.acceptedAt)}.
      </p>
    );
  }
  if (!canAccept) {
    return (
      <p className="mt-5 text-sm text-slate-600" data-testid="contract-not-accepted">
        Khách chưa bấm Đồng ý hợp đồng. Nhân viên chỉ bàn giao xe sau khi khách đã đồng ý.
      </p>
    );
  }

  async function submit(event) {
    event.preventDefault();
    if (!checked || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await apiClient.post(`/bookings/${encodeURIComponent(bookingId)}/contract/accept`);
      onAccepted?.();
    } catch (acceptError) {
      setError(getErrorMessage(acceptError, "Chưa ghi nhận được việc đồng ý hợp đồng."));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="mt-6 space-y-3 rounded-md border border-teal-200 bg-teal-50 p-4" aria-label="Đồng ý hợp đồng" onSubmit={submit}>
      <p className="text-sm">Hợp đồng có hiệu lực khi bạn bấm Đồng ý. Nhân viên chỉ bàn giao xe sau bước này.</p>
      <label className="flex gap-3 text-sm">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        Tôi đã đọc và đồng ý toàn bộ các điều khoản của hợp đồng này.
      </label>
      {error ? <Notice error>{error}</Notice> : null}
      <button className="btn" disabled={!checked || busy}>{busy ? "Đang ghi nhận..." : "Đồng ý"}</button>
    </form>
  );
}
