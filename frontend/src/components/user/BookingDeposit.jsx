import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import apiClient from '../../api/client';
import { useApiData } from '../../hooks/useApiData';
import { money, Notice, Page } from '../common/PageKit';
import { getErrorMessage } from '../../utils/roles';
import { vietnamDay } from '../../utils/bookingQueue';

export const paymentLabels = { PENDING: 'Đang xác minh', UNKNOWN: 'Cần đối soát', SUCCEEDED: 'Đã nhận', FAILED: 'Thất bại' };
export const refundLabels = { REQUESTED: 'Chờ Admin quyết định', APPROVED: 'Đã duyệt hoàn', PROCESSING: 'Đang xử lý', UNKNOWN: 'Cần đối soát', SUCCEEDED: 'Đã hoàn', FAILED: 'Hoàn thất bại', DECLINED: 'Không hoàn' };
const eventLabels = { PAYMENT_CREATED: 'Tạo phiên thanh toán', DEPOSIT_APPROVED: 'Duyệt hồ sơ, yêu cầu cọc', DEPOSIT_APPROVED_QR: 'Duyệt hồ sơ, tạo mã QR cọc', PAYMENT_RECEIVED: 'Xác minh đã nhận cọc', PAYMENT_FAILED: 'Thanh toán thất bại', PAYMENT_UNKNOWN: 'Thanh toán cần đối soát', DEPOSIT_APPLIED: 'Xác nhận đơn từ cọc', REFUND_REQUESTED: 'Tạo yêu cầu hoàn', REFUND_DECIDED: 'Duyệt khoản hoàn', REFUND_RECONCILED: 'Đối soát khoản hoàn' };
const date = value => value ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value)) : '—';

export default function BookingDeposit({ booking, role, assignedPickup, reload, now }) {
  const request = useApiData(`/bookings/${encodeURIComponent(booking.id)}/deposit`);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [contacted, setContacted] = useState(false), [notDelivered, setNotDelivered] = useState(false), [reason, setReason] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [qrData, setQrData] = useState(null);
  const [reportForm, setReportForm] = useState({ transactionRef: '', transferTime: '', transferNote: '', sourceAccount: '' });
  const [verifyForm, setVerifyForm] = useState({ transactionRef: '', amountVnd: '', transferTime: '', transferNote: '', sourceAccount: '', idempotencyKey: '' });
  const data = request.data;

  async function action(path, body = {}) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await apiClient.post(`/bookings/${encodeURIComponent(booking.id)}/${path}`, body);
      if (response.data?.url) window.location.assign(response.data.url);
      else { request.reload(); reload(); }
    } catch (e) { setError(getErrorMessage(e, 'Không thể xử lý khoản cọc.')); }
    finally { setBusy(false); }
  }

  async function loadQr() {
    try {
      const res = await apiClient.get(`/bookings/${encodeURIComponent(booking.id)}/deposit/qr-payload`);
      setQrData(res.data);
      setShowQr(true);
    } catch (e) { setError(getErrorMessage(e, 'Không tải được mã QR.')); }
  }

  async function handleReport() {
    if (busy) return;
    if (!reportForm.transactionRef || !reportForm.transferTime) { setError('Thiếu mã tham chiếu hoặc thời điểm chuyển.'); return; }
    setBusy(true); setError('');
    try {
      await apiClient.post(`/bookings/${encodeURIComponent(booking.id)}/deposit/report`, {
        transactionRef: reportForm.transactionRef,
        transferTime: reportForm.transferTime,
        transferNote: reportForm.transferNote,
        sourceAccount: reportForm.sourceAccount,
        idempotencyKey: `report-${booking.id}-${reportForm.transactionRef}-${reportForm.transferTime}`
      });
      request.reload(); reload(); setShowQr(false);
    } catch (e) { setError(getErrorMessage(e, 'Không thể gửi báo chuyển khoản.')); }
    finally { setBusy(false); }
  }

  async function handleVerify() {
    if (busy) return;
    if (!verifyForm.transactionRef || !verifyForm.amountVnd || !verifyForm.transferTime || !verifyForm.idempotencyKey) {
      setError('Thiếu thông tin bắt buộc (tham chiếu, số tiền, thời điểm, khóa idempotency).'); return;
    }
    setBusy(true); setError('');
    try {
      await apiClient.post(`/bookings/${encodeURIComponent(booking.id)}/deposit/verify`, {
        transactionRef: verifyForm.transactionRef,
        amountVnd: Number(verifyForm.amountVnd),
        transferTime: verifyForm.transferTime,
        transferNote: verifyForm.transferNote,
        sourceAccount: verifyForm.sourceAccount,
        idempotencyKey: verifyForm.idempotencyKey,
        expectedVersion: booking.version
      });
      request.reload(); reload(); setShowQr(false);
    } catch (e) { setError(getErrorMessage(e, 'Không thể xác minh khoản cọc.')); }
    finally { setBusy(false); }
  }

  const deposit = booking.deposit;
  const isQr = deposit?.method === 'DEMO_QR_MANUAL';
  const isVnpay = deposit?.method === 'VNPAY_SANDBOX';
  const depositApproved = deposit?.approvedAt;
  const depositDue = deposit?.paymentDueAt;
  const reviewDue = deposit?.reviewDueAt;
  const originalHold = deposit?.originalHoldUntil;
  const reportedAt = deposit?.reportedAt;
  const appliedAmount = deposit?.appliedAmount ?? 0;
  const receivedAmount = deposit?.receivedAmount ?? 0;
  const missingAmount = deposit?.missingAmount ?? 0;
  const excessAmount = deposit?.excessAmount ?? 0;
  const depositMode = deposit?.mode ?? 'FULL';

  return <section className="panel mb-5">
    <h2 className="mb-3 text-lg font-semibold">
      Cọc giữ chỗ {isQr ? '· QR giả lập (DEMO)' : isVnpay ? '· VNPAY Sandbox' : ''}
    </h2>
    {isQr && <p className="text-amber-700 font-medium">Mô phỏng — Không chuyển tiền thật. Chỉ nhân viên đối soát thủ công.</p>}
    <p>Cọc: <strong>{money(deposit?.amount)}</strong> · Còn lại: {money(booking.total - deposit?.amount)}</p>
    <p>{deposit?.txnRef ? 'Đã ghi nhận cọc cho đơn' : booking.status !== 'PENDING' ? 'Đơn không còn chờ đóng cọc. Xem tình trạng thu/hoàn bên dưới.' :
      depositApproved ? `Chờ đóng cọc · Hạn thanh toán ${date(depositDue)} · Hạn đối soát ${date(reviewDue)}` : 'Chờ kiểm tra hồ sơ'}</p>
    {depositApproved && originalHold && <p className="text-sm text-slate-600">Hạn giữ lịch gốc: {date(originalHold)}</p>}

    {booking.status === 'PENDING' && data && !data.acceptingNew && isVnpay ?
      <p>Đang tạm dừng tạo thanh toán mới. Giao dịch đã tạo vẫn được hệ thống đối soát.</p> : null}

    {request.loading ? <p>Đang tải tình trạng thu/hoàn…</p> : null}
    {request.error ? <Notice error>{request.error}<button className="btn-secondary" onClick={request.reload}>Tải lại</button></Notice> : null}
    {error ? <Notice error>{error}</Notice> : null}

    {isQr && depositApproved && role === 'USER' && booking.status === 'PENDING' && data?.acceptingNew && (
      <div className="mt-4 space-y-3">
        <button className="btn" disabled={busy} onClick={loadQr}>
          {showQr ? 'Ẩn mã QR' : 'Hiển thị mã QR cọc'}
        </button>
        {showQr && qrData && (
          <div className="space-y-3 border-t pt-3">
            <p className="text-sm text-amber-700"><strong>Mã yêu cầu:</strong> {qrData.requestCode}</p>
            <p className="text-sm text-amber-700"><strong>Số tiền:</strong> {money(qrData.amount)}</p>
            <p className="text-sm text-amber-700"><strong>Hạn thanh toán:</strong> {date(qrData.paymentDueAt)}</p>
            <p className="text-sm text-amber-700"><strong>Hạn đối soát:</strong> {date(qrData.reviewDueAt)}</p>
            <img src={`/api/v1/bookings/${encodeURIComponent(booking.id)}/deposit/qr`} alt="Mã QR cọc giả lập" style={{maxWidth: '200px'}} />
            <p className="text-xs text-red-600"><strong>{qrData.warning}</strong></p>
            <details className="text-sm">
              <summary>Thông tin tài khoản nhận (giả lập)</summary>
              <pre className="mt-2 whitespace-pre-wrap bg-slate-50 p-3 rounded">{qrData.receiverSnapshot}</pre>
            </details>
            <hr />
            <p className="font-medium">Tôi đã chuyển khoản (báo cho nhân viên đối soát)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block"><span className="text-sm">Mã tham chiếu giao dịch</span><input type="text" className="input" required value={reportForm.transactionRef} onChange={e => setReportForm({...reportForm, transactionRef: e.target.value})} /></label>
              <label className="block"><span className="text-sm">Thời điểm chuyển (giờ VN)</span><input type="datetime-local" className="input" required value={reportForm.transferTime} onChange={e => setReportForm({...reportForm, transferTime: e.target.value})} /></label>
            </div>
            <label className="block"><span className="text-sm">Nội dung chuyển khoản</span><input type="text" className="input" value={reportForm.transferNote} onChange={e => setReportForm({...reportForm, transferNote: e.target.value})} /></label>
            <label className="block"><span className="text-sm">Tài khoản nguồn (giả lập)</span><input type="text" className="input" value={reportForm.sourceAccount} onChange={e => setReportForm({...reportForm, sourceAccount: e.target.value})} /></label>
            <button className="btn mt-2" disabled={busy} onClick={handleReport}>Gửi báo đã chuyển khoản</button>
          </div>
        )}
      </div>
    )}

    {isQr && depositApproved && role === 'STAFF' && assignedPickup && booking.status === 'PENDING' && data?.acceptingNew && (
      <div className="mt-4 space-y-3 border-t pt-3">
        <p className="font-medium">Xác minh khoản cọc (Staff chi nhánh nhận)</p>
        <p className="text-sm text-slate-600">Nhập thông tin khoản tiền đã kiểm tra thực tế. Mỗi khoản cần khóa idempotency duy nhất.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="text-sm">Mã tham chiếu giao dịch</span><input type="text" className="input" required value={verifyForm.transactionRef} onChange={e => setVerifyForm({...verifyForm, transactionRef: e.target.value})} /></label>
          <label className="block"><span className="text-sm">Số tiền thực nhận (VND)</span><input type="number" className="input" min="1" step="1" required value={verifyForm.amountVnd} onChange={e => setVerifyForm({...verifyForm, amountVnd: e.target.value})} /></label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="text-sm">Thời điểm chuyển (giờ VN)</span><input type="datetime-local" className="input" required value={verifyForm.transferTime} onChange={e => setVerifyForm({...verifyForm, transferTime: e.target.value})} /></label>
          <label className="block"><span className="text-sm">Khóa idempotency (duy nhất)</span><input type="text" className="input" required value={verifyForm.idempotencyKey} onChange={e => setVerifyForm({...verifyForm, idempotencyKey: e.target.value})} placeholder="VD: verify-bookingId-ref-time" /></label>
        </div>
        <label className="block"><span className="text-sm">Nội dung chuyển khoản</span><input type="text" className="input" value={verifyForm.transferNote} onChange={e => setVerifyForm({...verifyForm, transferNote: e.target.value})} /></label>
        <label className="block"><span className="text-sm">Tài khoản nguồn (giả lập)</span><input type="text" className="input" value={verifyForm.sourceAccount} onChange={e => setVerifyForm({...verifyForm, sourceAccount: e.target.value})} /></label>
        <button className="btn mt-2" disabled={busy} onClick={handleVerify}>Xác minh và ghi nhận</button>
      </div>
    )}

    {role === 'STAFF' && assignedPickup && booking.status === 'PENDING' && data?.acceptingNew && isVnpay && (
      <button className="btn mt-3" disabled={busy} onClick={() => action('deposit/approve', { expectedVersion: booking.version })}>Duyệt hồ sơ và yêu cầu đóng cọc</button>
    )}

    {role === 'STAFF' && assignedPickup && booking.status === 'CONFIRMED' && vietnamDay(now) > vietnamDay(booking.startAt) && (
      <form className="mt-4 space-y-2" onSubmit={e => { e.preventDefault(); action('no-show', { expectedVersion: booking.version, contacted, notDelivered, reason }); }}>
        <p>Khách không đến nhận: chỉ xử lý sau hết ngày nhận; nếu đã giao xe, chuyển xử lý ngoại lệ.</p>
        <label className="block"><input type="checkbox" required checked={contacted} onChange={e => setContacted(e.target.checked)} /> Đã liên hệ khách</label>
        <label className="block"><input type="checkbox" required checked={notDelivered} onChange={e => setNotDelivered(e.target.checked)} /> Xe chưa thực sự được giao</label>
        <label className="block">Lý do<textarea className="input" required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <button className="btn-secondary" disabled={busy}>Ghi nhận khách không đến nhận</button>
      </form>
    )}

    {data?.payments?.map(p => <div key={p.id} className="mt-2 panel">
      <p className="font-medium">Giao dịch {p.id.slice(0, 8)} · {money(p.amount)} · {paymentLabels[p.status] || 'Cần kiểm tra'}</p>
      {p.appliedAmount !== undefined && <p className="text-sm">Đã áp dụng: {money(p.appliedAmount)} / {money(p.amount)}</p>}
      {p.transferTime && <p className="text-sm">Thời điểm chuyển: {date(p.transferTime)}</p>}
      {p.transferNote && <p className="text-sm">Nội dung: {p.transferNote}</p>}
      {p.sourceAccount && <p className="text-sm">Tài khoản nguồn: {p.sourceAccount}</p>}
      {p.verifierId && <p className="text-sm">Xác minh bởi: {p.verifierId} lúc {date(p.verifiedAt)}</p>}
    </div>)}

    {data?.refunds?.map(r => <div key={r.id} className="mt-2 panel">
      <p className="font-medium">Hoàn {money(r.amount)} · {refundLabels[r.status] || 'Cần kiểm tra'} · {r.reason}</p>
      <p className="text-sm">Loại: {r.kind} · Duyệt bởi: {r.approvedBy || '—'} · {r.approvedAt ? date(r.approvedAt) : '—'}</p>
    </div>)}

    {role === 'ADMIN' && data?.events?.length && (
      <details className="mt-3"><summary>Lịch sử xử lý cọc</summary>
      <ol className="mt-2 space-y-2 text-sm">{data.events.map((e, i) => <li key={`${e.created_at}-${i}`}>
        <p>{eventLabels[e.kind] || (e.kind.startsWith('REFUND_') ? `Hoàn tiền: ${refundLabels[e.kind.slice(7)] || 'Cần kiểm tra'}` : 'Cập nhật đối soát')} · {date(e.created_at)}</p>
        <p>{e.note} · {e.actor_id ? `Mã người thực hiện: ${e.actor_id}` : 'Hệ thống tự động'}</p>
      </li>)}</ol></details>
    )}

    {depositApproved && booking.status === 'PENDING' && (
      <div className="mt-3 p-3 bg-slate-50 rounded text-sm">
        <p><strong>Tóm tắt cọc:</strong> Đã nhận {money(receivedAmount)} · Đã áp dụng {money(appliedAmount)} · Còn thiếu {money(missingAmount)} {excessAmount > 0 ? `· Dư {money(excessAmount)}` : ''} · Trạng thái: {depositMode === 'FULL' ? 'Đủ' : depositMode === 'PARTIAL' ? 'Thiếu' : 'Dư'}</p>
        {reportedAt && <p>Khách đã báo chuyển khoản lúc {date(reportedAt)}</p>}
      </div>
    )}
  </section>;
}

export function PaymentReturnPage() {
  const [params] = useSearchParams();
  return <Page title="Kết quả thanh toán thử nghiệm"><section className="panel">
    <p>Đang xác minh với VNPAY Sandbox. Trang quay về không xác nhận đã nhận tiền.</p>
    {params.get('vnp_TxnRef') ? <p>Vui lòng mở đơn để xem kết quả thu cọc và hoàn tiền từ hệ thống.</p> : null}
    <Link className="btn mt-4" to="/user/bookings">Xem đơn thuê của tôi</Link>
  </section></Page>;
}