import { useSearchParams, Link } from "react-router-dom";
import { useApiData } from "../../hooks/useApiData";
import { Page, Notice, money } from "../../components/common/PageKit";
import { VehicleVisual } from "../../components/vehicle/VehicleCard";
import { normalizeVehicle } from "./ApiScreens";
import { compareSelection } from "../../utils/vehicleCompare";
import { searchParams, searchSuffix } from "../../utils/vehicleSearch";

function CompareColumn({ id, catalog, branches, search, onRemove }) {
  const request=useApiData(`/vehicles/${encodeURIComponent(id)}`);
  const vehicle=request.data ? normalizeVehicle(request.data,catalog) : null;
  return <article className="panel compare-column" aria-label={`So sánh ${vehicle?.name || id}`}>
    <button className="btn-secondary mb-3" onClick={onRemove} aria-label={`Bỏ ${vehicle?.name || id}`}>Bỏ xe</button>
    {request.loading ? <p role="status">Đang tải xe…</p> : request.error ? <div><Notice error>{request.error}</Notice><p>Không thể so sánh xe này.</p><button className="btn-secondary" onClick={request.reload}>Tải lại xe</button></div> : !vehicle ? <p>Xe không còn hiển thị.</p> : <>
      <VehicleVisual vehicle={vehicle} />
      <h2 className="my-3 text-xl font-bold"><Link to={`/vehicles/${encodeURIComponent(id)}${search}`}>{vehicle.name}</Link></h2>
      <dl className="compare-specs">
        <dt>Hãng</dt><dd>{catalog?.brands?.find(b=>b.id===vehicle.brandId)?.name || "Chưa tải được hãng"}</dd>
        <dt>Loại xe</dt><dd>{catalog?.categories?.find(c=>c.id===vehicle.categoryId)?.name || "Chưa tải được loại xe"}</dd>
        <dt>Số chỗ (gồm người lái)</dt><dd>{vehicle.seats}</dd>
        <dt>Hộp số</dt><dd>{vehicle.transmission}</dd>
        <dt>Tiện nghi</dt><dd>{vehicle.amenities?.length ? vehicle.amenities.map(a=>a.name).join(", ") : "Chưa có thông tin tiện nghi"}</dd>
        <dt>Chi nhánh hiện tại</dt><dd>{branches?.find(b=>b.id===vehicle.currentBranchId)?.name || "Chưa tải được chi nhánh"}</dd>
        <dt>Giá / block 24 giờ</dt><dd>{money(vehicle.price)}</dd>
      </dl>
    </>}
  </article>;
}

export default function ApiVehicleComparePage() {
  const [params,setParams]=useSearchParams();
  const selection=compareSelection(params.get("compare") || "");
  const catalog=useApiData("/vehicles/catalog",selection.ids.length>0);
  const branches=useApiData("/branches",selection.ids.length>0);
  return <Page title="So sánh xe" description="Đối chiếu tối đa 3 xe. Số chỗ bao gồm người lái.">
    <Link className="btn-secondary mb-5 inline-flex" to={`/vehicles${searchSuffix(params)}`}>Về danh sách xe</Link>
    <p className="mb-4" aria-live="polite">Đã chọn {selection.ids.length}/3 xe</p>
    {selection.issue ? <Notice error>{selection.issue}</Notice> : null}
    {catalog.error || branches.error ? <div><Notice error>{catalog.error || branches.error}</Notice><button className="btn-secondary mb-4" onClick={()=>{catalog.reload();branches.reload();}}>Tải lại danh mục</button></div> : null}
    {selection.ids.length<2 ? <p className="mb-4">Chọn thêm xe từ danh sách hoặc chi tiết để so sánh 2–3 xe.</p> : null}
    <div className="compare-scroll" tabIndex={0} role="region" aria-label="Bảng so sánh xe"><div className={`compare-grid compare-count-${selection.ids.length}`}>
      {selection.ids.map(id=><CompareColumn key={id} id={id} catalog={catalog.data} branches={branches.data} search={searchSuffix(params)} onRemove={()=>setParams(searchParams(params,{compare:selection.ids.filter(value=>value!==id).join(",")}))} />)}
    </div></div>
  </Page>;
}
