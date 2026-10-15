import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { compareSelection, toggleCompare } from "../../utils/vehicleCompare";
import { searchParams, searchSuffix } from "../../utils/vehicleSearch";

export function CompareToggle({ vehicleId, name }) {
  const [params,setParams] = useSearchParams();
  const {ids} = compareSelection(params.get("compare") || "");
  const [issue,setIssue] = useState("");
  const selected = ids.includes(vehicleId);
  return <div className="my-2"><button type="button" className="btn-secondary text-xs" aria-pressed={selected} aria-label={`${selected ? "Bỏ so sánh" : "So sánh"} ${name}`} onClick={() => {
    const next=toggleCompare(ids,vehicleId);setIssue(next.issue);
    if (!next.issue) setParams(searchParams(params,{compare:next.ids.join(",")}));
  }}>{selected ? "✓ Đã chọn so sánh" : "+ So sánh"}</button>{issue ? <p role="status" className="mt-2 text-xs text-red-700">{issue}</p> : null}</div>;
}

export default function CompareTray() {
  const [params,setParams] = useSearchParams();
  const {ids,issue} = compareSelection(params.get("compare") || "");
  return <aside className="panel mb-5" aria-label="Lựa chọn so sánh">
    <div className="flex flex-wrap items-center justify-between gap-3"><p>Đã chọn {ids.length}/3 xe {ids.length === 3 ? "· Đã đạt giới hạn" : "· Chọn 2–3 xe để đối chiếu"}</p>
      <div className="flex flex-wrap gap-2"><Link className="btn-secondary" to={`/vehicles/compare${searchSuffix(params)}`}>So sánh xe ({ids.length})</Link>{ids.length ? <button className="btn-secondary" onClick={() => setParams(searchParams(params,{compare:""}))}>Bỏ tất cả xe</button> : null}</div></div>
    {issue ? <p role="status" className="mt-2 text-sm text-red-700">{issue}</p> : null}
  </aside>;
}
