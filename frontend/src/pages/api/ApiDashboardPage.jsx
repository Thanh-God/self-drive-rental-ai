import { useState } from "react";
import { operationalReportPath } from "../../api/reports";
import { useApiData } from "../../hooks/useApiData";
import { currentVietnamMonth, reportDateError } from "../../utils/reportDates";
import { Page, Field, Notice, money, dateTime } from "../../components/common/PageKit";
import LoadingSkeleton from "../../components/common/LoadingSkeleton";
import { statusLabels } from "../../demo/model";

export default function ApiDashboardPage() {
  const [applied, setApplied] = useState(currentVietnamMonth);
  const [draft, setDraft] = useState(applied);
  const [validation, setValidation] = useState("");
  const request = useApiData(operationalReportPath(applied.from, applied.to));
  const data = request.data;
  function apply(event) {
    event.preventDefault();
    const error = reportDateError(draft.from, draft.to);
    setValidation(error);
    if (error || request.loading) return;
    if (draft.from === applied.from && draft.to === applied.to) request.reload();
    else setApplied({ ...draft });
  }
  return <Page title="Báo cáo vận hành" description="Số liệu hệ thống theo ngày Việt Nam. Tổng giá trị hóa đơn không xác nhận tiền đã thanh toán.">
    <form onSubmit={apply} className="panel mb-6 flex flex-wrap items-end gap-4">
      <Field label="Từ ngày"><input type="date" min="1970-01-02" max="2038-01-18" required value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} /></Field>
      <Field label="Đến ngày"><input type="date" min="1970-01-02" max="2038-01-18" required value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} /></Field>
      <button className="btn" type="submit" disabled={request.loading}>Xem báo cáo</button>
      <button className="btn-secondary" type="button" disabled={request.loading} onClick={request.reload}>Làm mới</button>
    </form>
    {validation && <Notice error>{validation}</Notice>}
    <p className="mb-4 text-sm text-slate-600">Khoảng đang xem: {applied.from} – {applied.to} (Asia/Ho_Chi_Minh), bao gồm cả hai ngày. Tối đa 366 ngày.</p>
    {request.loading ? <LoadingSkeleton /> : request.error ? <div className="space-y-3"><Notice error>{request.error}</Notice><button type="button" className="btn-secondary" onClick={request.reload}>Thử tải lại</button></div> : data ? <>
      <div className="grid gap-4 lg:grid-cols-4" data-testid="report-metrics">
        {[["Đơn tạo trong khoảng", data.createdBookings.total], ["Đơn hoàn tất trong khoảng", data.completedBookings], ["Hóa đơn phát hành", data.issuedInvoices], ["Tổng giá trị hóa đơn", money(BigInt(data.invoiceTotalVnd))]].map(([label, value]) => <section className="panel" key={label}><h2 className="text-sm text-slate-600">{label}</h2><p className="mt-3 text-2xl font-bold" data-metric={label}>{value}</p></section>)}
      </div>
      {data.createdBookings.total === 0 && data.completedBookings === 0 && data.issuedInvoices === 0 && <div className="mt-5"><Notice>Chưa có dữ liệu trong khoảng đã chọn.</Notice></div>}
      <section className="panel mt-6"><h2 className="text-lg font-semibold">Trạng thái hiện tại của các đơn tạo trong khoảng</h2><p className="my-3 text-sm text-slate-600">Đây là trạng thái lúc xem báo cáo, không phải lịch sử trạng thái tại ngày kết thúc. Đơn chờ đã hết hạn được tính là hết hạn.</p>
        <table className="w-full text-left"><thead><tr><th className="py-2">Trạng thái</th><th className="py-2 text-right">Số đơn</th></tr></thead><tbody>{Object.entries(data.createdBookings.byStatus).map(([status, count]) => <tr key={status}><td className="py-2">{statusLabels[status] || status}</td><td className="py-2 text-right" data-status={status}>{count}</td></tr>)}</tbody></table>
      </section><p className="mt-4 text-sm text-slate-600">Mốc tính đơn hết hạn: {dateTime(data.asOf)}. Hóa đơn và đơn hoàn tất được lọc theo mốc phát hành/hoàn tất riêng.</p>
    </> : null}
  </Page>;
}
