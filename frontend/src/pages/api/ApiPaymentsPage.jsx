import { useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../api/client';
import { useApiData } from '../../hooks/useApiData';
import { Page, Notice, money } from '../../components/common/PageKit';
import { refundLabels, paymentLabels } from '../../components/user/BookingDeposit';
import { getErrorMessage } from '../../utils/roles';
import { adminDateFormat } from '../../utils/bookingQueue';

export function RefundRow({ item, run, busy, depositMethod }) {
  const [amount, setAmount] = useState(String(item.amount)), [reason, setReason] = useState('');
  const isQr = depositMethod === 'DEMO_QR_MANUAL';
  return <section className="panel space-y-3">
    <Link to={`/admin/bookings/${item.bookingId}`}>Đơn {item.bookingId.slice(0, 8)}</Link>
    <p>{refundLabels[item.status] || 'Cần kiểm tra'} · {money(item.amount)} · {item.reason}</p>
    <details className="text-sm"><summary>Thông tin đối soát</summary><dl className="mt-2 space-y-2 break-all">
      <div><dt>Mã yêu cầu hoàn</dt><dd>{item.id}</dd></div>
      <div><dt>Tham chiếu thanh toán</dt><dd>{item.paymentId}</dd></div>
      {isQr ? (
        <div><dt>Phương thức</dt><dd>QR DEMO (thủ công)</dd></div>
      ) : (
        <div><dt>Tham chiếu VNPAY</dt><dd>{item.providerTransaction || 'Chưa có kết quả xác minh'}</dd></div>
      )}
      <div><dt>Người duyệt (mã tài khoản)</dt><dd>{item.approvedBy || (item.status === 'REQUESTED' ? 'Chưa quyết định' : 'Theo chính sách tự động')}</dd></div>
      <div><dt>Thời điểm duyệt</dt><dd>{item.approvedAt ? adminDateFormat(item.approvedAt, { withTime: true }) : '—'}</dd></div>
    </dl></details>
    {item.status === 'REQUESTED' ? <form className="space-y-2" onSubmit={e => { e.preventDefault(); run(`/admin/refunds/${item.id}/decide`, { expectedVersion: item.version, amount: Number(amount), reason }); }}>
      <label className="block">Số tiền hoàn (VND)<input type="number" min="0" step="1" required value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className="block">Lý do quyết định<textarea required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button className="btn" disabled={busy}>Duyệt khoản hoàn</button>
    </form> : null}
    {isQr && item.status === 'APPROVED' ? (
      <button className="btn-secondary" disabled={busy} onClick={() => run(`/admin/refunds/${item.id}/process-manual`)}>
        Ghi nhận đã hoàn thủ công (QR DEMO)
      </button>
    ) : item.status === 'APPROVED' ? (
      <button className="btn-secondary" disabled={busy} onClick={() => run(`/admin/refunds/${item.id}/process`)}>Gửi hoàn VNPAY Sandbox</button>
    ) : null}
    {['PROCESSING', 'UNKNOWN'].includes(item.status) ? <p>Cần kiểm tra kết quả. Không gửi lại yêu cầu hoàn khi chưa rõ kết quả.</p> : null}
    {['PROCESSING', 'UNKNOWN'].includes(item.status) && !isQr ? <button className="btn-secondary" disabled={busy} onClick={() => run(`/admin/refunds/${item.id}/reconcile`)}>Truy vấn kết quả hoàn</button> : null}
    {isQr && ['PROCESSING', 'UNKNOWN'].includes(item.status) ? <p>Khoản QR DEMO: Admin ghi nhận thủ công khi đã hoàn tiền.</p> : null}
  </section>;
}

export function ManualRefundForm({ payment, run, busy }) {
  const [amount, setAmount] = useState(''), [reason, setReason] = useState('');
  return <section className="panel space-y-3">
    <p>Tạo yêu cầu hoàn thủ công cho khoản QR DEMO</p>
    <p>Thanh toán: {payment.id.slice(0,8)} · {money(payment.amount)} · Đã áp dụng: {money(payment.appliedAmount || 0)}</p>
    <form className="space-y-2" onSubmit={e => { e.preventDefault(); run(`/admin/refunds/create-manual`, { paymentId: payment.id, amount: Number(amount), reason }); }}>
      <label className="block">Số tiền hoàn (VND)<input type="number" min="0" step="1" required value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className="block">Lý do<textarea required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button className="btn" disabled={busy}>Tạo yêu cầu hoàn</button>
    </form>
  </section>;
}

export default function ApiPaymentsPage() {
  const request = useApiData('/admin/payments');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [showManualRefundFor, setShowManualRefundFor] = useState(null);

  async function run(path, body = {}) {
    if (busy) return; setBusy(true); setError('');
    try { await apiClient.post(path, body); request.reload(); setShowManualRefundFor(null); }
    catch (e) { setError(getErrorMessage(e, 'Không thể xử lý; kiểm tra kết quả trước khi thử lại.')); }
    finally { setBusy(false); }
  }

  return <Page title="Cọc và hoàn tiền · Sandbox" actions={<button className="btn-secondary" onClick={request.reload}>Tải lại</button>}>
    <p className="mb-4">Chỉ thử nghiệm. Trạng thái đơn, thu cọc và hoàn tiền được theo dõi riêng.</p>
    {error || request.error ? <Notice error>{error || request.error}</Notice> : null}
    {request.loading ? <p>Đang tải…</p> : null}
    <h2 className="mb-3 text-lg font-semibold">Giao dịch cần đối soát</h2>
    {request.data?.unresolved?.map(p => {
      const isQr = p.depositMethod === 'DEMO_QR_MANUAL';
      return <section className="panel mb-3" key={p.id}>
        <Link to={`/admin/bookings/${p.bookingId}`}>Đơn {p.bookingId.slice(0, 8)}</Link>
        <p>{p.id} · {money(p.amount)} · {paymentLabels[p.status]} {isQr ? '· QR DEMO' : '· VNPAY'}</p>
        {isQr ? (
          <p className="text-sm text-amber-700">Khoản QR DEMO: Staff đã xác minh thủ công. Admin xử lý hoàn thủ công nếu cần.</p>
        ) : (
          <button className="btn-secondary" disabled={busy} onClick={() => run(`/admin/payments/${p.id}/reconcile`)}>Đối soát với VNPAY</button>
        )}
      </section>;
    })}
    <h2 className="my-3 text-lg font-semibold">Yêu cầu hoàn tiền</h2>
    <div className="space-y-3">
      {request.data?.refunds?.map(r => <RefundRow key={`${r.id}-${r.version}`} item={r} run={run} busy={busy} depositMethod={r.depositMethod} />)}
      {showManualRefundFor && <ManualRefundForm payment={showManualRefundFor} run={run} busy={busy} />}
    </div>
    {!request.loading && request.data && !request.data.refunds.length && !request.data.unresolved.length ? <p>Chưa có giao dịch cần xử lý.</p> : null}
    {request.data?.payments?.filter(p => p.depositMethod === 'DEMO_QR_MANUAL' && p.status === 'SUCCEEDED' && (p.appliedAmount || 0) < p.amount).map(p => (
      <section className="panel mb-3" key={p.id}>
        <Link to={`/admin/bookings/${p.bookingId}`}>Đơn {p.bookingId.slice(0, 8)}</Link>
        <p>{p.id} · {money(p.amount)} · QR DEMO · Dư chưa hoàn: {money(p.amount - (p.appliedAmount || 0))}</p>
        <button className="btn-secondary" onClick={() => setShowManualRefundFor(p)}>Tạo yêu cầu hoàn dư</button>
      </section>
    ))}
  </Page>;
}