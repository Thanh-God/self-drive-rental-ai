import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import apiClient from '../../api/client';
import { useApiData } from '../../hooks/useApiData';
import { money, Notice, Page } from '../common/PageKit';
import { getErrorMessage } from '../../utils/roles';
import { vietnamDay } from '../../utils/bookingQueue';

export const paymentLabels = { PENDING: 'Đang xác minh', UNKNOWN: 'Cần đối soát', SUCCEEDED: 'Đã nhận', FAILED: 'Thất bại' };
export const refundLabels = { REQUESTED: 'Chờ Admin quyết định', APPROVED: 'Đã duyệt hoàn', PROCESSING: 'Đang xử lý', UNKNOWN: 'Cần đối soát', SUCCEEDED: 'Đã hoàn', FAILED: 'Hoàn thất bại', DECLINED: 'Không hoàn' };
const date = value => value ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value)) : '—';

export default function BookingDeposit({ booking, role, assignedPickup, reload, now }) {
  const request = useApiData(`/bookings/${encodeURIComponent(booking.id)}/deposit`);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [contacted, setContacted] = useState(false), [notDelivered, setNotDelivered] = useState(false), [reason, setReason] = useState('');
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
  return <section className="panel mb-5">
    <h2 className="mb-3 text-lg font-semibold">Cọc giữ chỗ · VNPAY Sandbox</h2>
    <p>Chỉ thử nghiệm, không thu tiền thật. Cọc tính vào tiền thuê, không dùng để trừ thiệt hại.</p>
    <p className="mt-2">Cọc: <strong>{money(booking.deposit.amount)}</strong> · Còn lại: {money(booking.total - booking.deposit.amount)}</p>
    <p>{booking.deposit.txnRef ? 'Đã ghi nhận cọc cho đơn' : booking.status !== 'PENDING' ? 'Đơn không còn chờ đóng cọc. Xem tình trạng thu/hoàn bên dưới.' : booking.deposit.approvedAt ? `Chờ đóng cọc · Hạn ${date(booking.deposit.dueAt)}` : 'Chờ kiểm tra hồ sơ'}</p>
    {booking.status === 'PENDING' && data && !data.acceptingNew ? <p>Đang tạm dừng tạo thanh toán mới. Giao dịch đã tạo vẫn được hệ thống đối soát.</p> : null}
    {request.loading ? <p>Đang tải tình trạng thu/hoàn…</p> : null}
    {request.error ? <Notice error>{request.error}<button className="btn-secondary" onClick={request.reload}>Tải lại</button></Notice> : null}
    {error ? <Notice error>{error}</Notice> : null}
    {role === 'USER' && booking.status === 'PENDING' && booking.deposit.approvedAt && data?.acceptingNew ? <button className="btn mt-3" disabled={busy} onClick={() => action('deposit/session')}>Thanh toán cọc thử nghiệm</button> : null}
    {role === 'STAFF' && assignedPickup && booking.status === 'PENDING' && data?.acceptingNew ? <button className="btn mt-3" disabled={busy} onClick={() => action('deposit/approve', { expectedVersion: booking.version })}>Duyệt hồ sơ và yêu cầu đóng cọc</button> : null}
    {role === 'STAFF' && assignedPickup && booking.status === 'CONFIRMED' && vietnamDay(now) > vietnamDay(booking.startAt) ? <form className="mt-4 space-y-2" onSubmit={e => { e.preventDefault(); action('no-show', { expectedVersion: booking.version, contacted, notDelivered, reason }); }}>
      <p>Khách không đến nhận: chỉ xử lý sau hết ngày nhận; nếu đã giao xe, chuyển xử lý ngoại lệ.</p>
      <label className="block"><input type="checkbox" required checked={contacted} onChange={e => setContacted(e.target.checked)} /> Đã liên hệ khách</label>
      <label className="block"><input type="checkbox" required checked={notDelivered} onChange={e => setNotDelivered(e.target.checked)} /> Xe chưa thực sự được giao</label>
      <label className="block">Lý do<textarea className="input" required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button className="btn-secondary" disabled={busy}>Ghi nhận khách không đến nhận</button>
    </form> : null}
    {data?.payments?.map(p => <p key={p.id} className="mt-2">Giao dịch {p.id.slice(0, 8)} · {money(p.amount)} · {paymentLabels[p.status] || 'Cần kiểm tra'}</p>)}
    {data?.refunds?.map(r => <p key={r.id} className="mt-2">Hoàn {money(r.amount)} · {refundLabels[r.status] || 'Cần kiểm tra'} · {r.reason}</p>)}
  </section>;
}

export function PaymentReturnPage() {
  const [params] = useSearchParams();
  // Return query is not proof of payment. The customer reads the booking from their account.
  return <Page title="Kết quả thanh toán thử nghiệm"><section className="panel">
    <p>Đang xác minh với VNPAY Sandbox. Trang quay về không xác nhận đã nhận tiền.</p>
    {params.get('vnp_TxnRef') ? <p>Vui lòng mở đơn để xem kết quả thu cọc và hoàn tiền từ hệ thống.</p> : null}
    <Link className="btn mt-4" to="/user/bookings">Xem đơn thuê của tôi</Link>
  </section></Page>;
}
