import { Field, Notice } from "../common/PageKit";
import { useState } from "react";

export default function TripSearchForm({ params, branches, loading, error, onRetry, onSubmit, onClear }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(["start", "end", "pickupBranchId", "returnBranchId", "budget"].map(key => [key, params.get(key) || ""])));
  const change = key => event => setDraft(old => ({ ...old, [key]: event.target.value }));
  return <form className="panel mb-6" aria-label="Tìm xe theo chuyến" onSubmit={event => { event.preventDefault(); onSubmit(draft); }}>
    <h2 className="mb-2 text-lg font-bold">Tìm xe cho chuyến đi</h2>
    <p className="mb-4 text-sm text-slate-600">Giờ Việt Nam · Số chỗ gồm người lái. Tổng chuyến gồm tiền thuê theo block 24 giờ và phí trả khác điểm.</p>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <Field label="Thời gian nhận"><input required type="datetime-local" value={draft.start} onChange={change("start")} /></Field>
      <Field label="Thời gian trả"><input required type="datetime-local" value={draft.end} onChange={change("end")} /></Field>
      {[ ["pickupBranchId", "Điểm nhận"], ["returnBranchId", "Điểm trả"] ].map(([key, label]) => <Field key={key} label={label}><select required disabled={loading || Boolean(error)} value={draft[key]} onChange={change(key)}><option value="">Chọn chi nhánh</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Field>)}
      <Field label="Ngân sách cả chuyến (VND)"><input type="number" min="0" step="1" placeholder="Không giới hạn" value={draft.budget} onChange={change("budget")} /></Field>
    </div>
    {error ? <div><Notice error>{error}</Notice><button type="button" className="btn-secondary" onClick={onRetry}>Tải lại chi nhánh</button></div> : null}
    <div className="mt-4 flex flex-wrap gap-3"><button className="btn" disabled={loading || Boolean(error)}>Tìm xe trống</button><button type="button" className="btn-secondary" onClick={onClear}>Bỏ điều kiện chuyến</button></div>
    <p className="mt-3 text-xs text-slate-500">Kết quả tại thời điểm tìm kiếm chưa giữ chỗ. Giá và lịch được kiểm tra lại khi báo giá; tiền cọc và khoản phát sinh chưa nằm trong tổng này.</p>
  </form>;
}
