import { useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../api/client';
import { useApiData } from '../../hooks/useApiData';
import { Page, Notice, money } from '../../components/common/PageKit';
import { refundLabels, paymentLabels } from '../../components/user/BookingDeposit';
import { getErrorMessage } from '../../utils/roles';

function RefundRow({ item, run, busy }) {
  const [amount, setAmount] = useState(String(item.amount)), [reason, setReason] = useState('');
  return <section className="panel space-y-3">
    <Link to={`/admin/bookings/${item.bookingId}`}>Đơn {item.bookingId.slice(0, 8)}</Link>
    <p>{refundLabels[item.status] || 'Cần kiểm tra'} · {money(item.amount)} · {item.reason}</p>
    {item.status === 'REQUESTED' ? <form className="space-y-2" onSubmit={e => { e.preventDefault(); run(`/admin/refunds/${item.id}/decide`, { expectedVersion: item.version, amount: Number(amount), reason }); }}>
      <label className="block">Số tiền hoàn (VND)<input type="number" min="0" step="1" required value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className="block">Lý do quyết định<textarea required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button className="btn" disabled={busy}>Duyệt khoản hoàn</button>
    </form> : null}
    {item.status === 'APPROVED' ? <button className="btn-secondary" disabled={busy} onClick={() => run(`/admin/refunds/${item.id}/process`)}>Gửi hoàn VNPAY Sandbox</button> : null}
    {['PROCESSING', 'UNKNOWN'].includes(item.status) ? <p>Cần kiểm tra kết quả tại merchant. Không gửi lại yêu cầu hoàn khi chưa rõ kết quả.</p> : null}
    {['PROCESSING', 'UNKNOWN'].includes(item.status) ? <button className="btn-secondary" disabled={busy} onClick={() => run(`/admin/refunds/${item.id}/reconcile`)}>Truy vấn kết quả hoàn</button> : null}
  </section>;
}
export default function ApiPaymentsPage() {
  const request = useApiData('/admin/payments');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function run(path, body = {}) {
    if (busy) return; setBusy(true); setError('');
    try { await apiClient.post(path, body); request.reload(); }
    catch (e) { setError(getErrorMessage(e, 'Không thể xử lý; kiểm tra kết quả trước khi thử lại.')); }
    finally { setBusy(false); }
  }
  return <Page title="Cọc và hoàn tiền · Sandbox" actions={<button className="btn-secondary" onClick={request.reload}>Tải lại</button>}>
    <p className="mb-4">Chỉ thử nghiệm. Trạng thái đơn, thu cọc và hoàn tiền được theo dõi riêng.</p>
    {error || request.error ? <Notice error>{error || request.error}</Notice> : null}
    {request.loading ? <p>Đang tải…</p> : null}
    <h2 className="mb-3 text-lg font-semibold">Giao dịch cần đối soát</h2>
    {request.data?.unresolved?.map(p => <section className="panel mb-3" key={p.id}>
      <Link to={`/admin/bookings/${p.bookingId}`}>Đơn {p.bookingId.slice(0, 8)}</Link>
      <p>{p.id} · {money(p.amount)} · {paymentLabels[p.status]}</p>
      <button className="btn-secondary" disabled={busy} onClick={() => run(`/admin/payments/${p.id}/reconcile`)}>Đối soát với VNPAY</button>
    </section>)}
    <h2 className="my-3 text-lg font-semibold">Yêu cầu hoàn tiền</h2>
    <div className="space-y-3">{request.data?.refunds?.map(r => <RefundRow key={`${r.id}-${r.version}`} item={r} run={run} busy={busy} />)}</div>
    {!request.loading && request.data && !request.data.refunds.length && !request.data.unresolved.length ? <p>Chưa có giao dịch cần xử lý.</p> : null}
  </Page>;
}
