import VehicleGallery from "../../components/vehicle/VehicleGallery";
import PasswordField from "../../components/common/PasswordField";
import { passwordError, passwordHint } from "../../utils/passwordPolicy";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Field,
  Missing,
  money,
  Notice,
  Page,
  Status,
  dateTime,
  toUTC,
} from "../../components/common/PageKit";
import EmptyState from "../../components/common/EmptyState";
import LoadingSkeleton from "../../components/common/LoadingSkeleton";
import VehicleCard, {
  VehicleVisual,
} from "../../components/vehicle/VehicleCard";
import {
  quoteRequestIsCurrent,
  sameBookingInput,
} from "../../api/bookingInput";
import { getBookingActions } from "../../api/bookingActions";
import apiClient from "../../api/client";
import { eventsForSelectedIncident } from "../../utils/incidentEvents";
import {
  applyBookingAction,
  createBooking,
  quoteBooking,
  saveLicense,
  updatePassword,
  updateProfile,
} from "../../api/rental";
import { getErrorMessage } from "../../utils/roles";
import { createRequestGeneration } from "../../utils/requestGeneration";
import { useAuth } from "../../context/AuthContext";
import { useApiData } from "../../hooks/useApiData";
import useNow from "../../hooks/useNow";

function RequestState({ loading, error, onRetry, children }) {
  if (loading) return <LoadingSkeleton rows={3} />;
  if (error)
    return (
      <div>
        <Notice error>{error}</Notice>
        <button className="btn-secondary" onClick={onRetry}>
          Thử tải lại
        </button>
      </div>
    );
  return children;
}

export function normalizeVehicle(vehicle, catalog) {
  const brandNames = new Map(
    (catalog?.brands || []).map((item) => [item.id, item.name]),
  );
  const categoryNames = new Map(
    (catalog?.categories || []).map((item) => [item.id, item.name]),
  );
  return {
    ...vehicle,
    noLocalAsset: true,
    images: Array.isArray(vehicle.images) ? [...vehicle.images].sort((a, b) => a.sortOrder - b.sortOrder || String(a.id).localeCompare(String(b.id))) : [],
    price: vehicle.dailyPrice,
    brand:
      brandNames.get(vehicle.brandId) || vehicle.brandId || "Chưa phân loại",
    category:
      categoryNames.get(vehicle.categoryId) ||
      vehicle.categoryId ||
      "Chưa phân loại",
    transmission: vehicle.transmission === "AUTO" ? "Tự động" : "Số sàn",
    fuel: "Chưa cập nhật",
    amenities: Array.isArray(vehicle.amenities) ? vehicle.amenities : [],
  };
}

function VehicleOperationalStatus({ status }) {
  const available = status === "ACTIVE";
  const label =
    status === "ACTIVE"
      ? "Đang khai thác"
      : status === "MAINTENANCE"
        ? "Đang bảo trì"
        : "Ngừng khai thác";
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${
        available
          ? "bg-emerald-50 text-emerald-800"
          : "bg-amber-50 text-amber-800"
      }`}
      role="status"
    >
      {label}
    </span>
  );
}

function localDateTime(value) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? ""
    : new Date(timestamp + 7 * 3600000).toISOString().slice(0, 16);
}

function IncidentSection({ booking, records = [], area }) {
  const request = useApiData(
    `/incidents?bookingId=${encodeURIComponent(booking.id)}`,
  );
  const [selectedId, setSelectedId] = useState("");
  const [eventHistory, setEventHistory] = useState({
    incidentId: null,
    events: [],
  });
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const reportPending = useRef(false);
  const actionPending = useRef(false);
  const loadEventsRequestId = useRef(0);
  const cases = Array.isArray(request.data) ? request.data : [];
  const selectedEvents = eventsForSelectedIncident(selectedId, eventHistory);
  const handoverRecord = records.find((record) => record.kind === "HANDOVER");
  const returnRecord = records.find((record) => record.kind === "RETURN");
  const custodyStart = localDateTime(handoverRecord?.occurred_at);
  const custodyEnd =
    localDateTime(returnRecord?.occurred_at) || toVietnamInput(0);
  const canReport = ["IN_PROGRESS", "RETURNED", "COMPLETED"].includes(
    booking.status,
  );

  async function report(event) {
    event.preventDefault();
    if (reportPending.current) return;
    reportPending.current = true;
    setFormError("");
    setNotice("");
    setBusy(true);
    const target = event.currentTarget;
    const form = new FormData(target);
    try {
      await apiClient.post("/incidents", {
        bookingId: booking.id,
        kind: String(form.get("kind") || ""),
        occurredAt: toUTC(String(form.get("occurredAt") || "")),
        description: String(form.get("description") || ""),
        evidenceReference: String(form.get("evidenceReference") || "") || null,
        blockVehicle: area !== "user" && form.get("blockVehicle") === "on",
      });
      setNotice(
        "Đã lập hồ sơ sự cố. Chưa có kết luận trách nhiệm hoặc khấu trừ.",
      );
      request.reload();
      target.reset();
    } catch (error) {
      setFormError(getErrorMessage(error, "Không thể lập hồ sơ sự cố."));
    } finally {
      reportPending.current = false;
      setBusy(false);
    }
  }

  async function updateIncident(event, incident, next) {
    event.preventDefault();
    if (actionPending.current) return;
    actionPending.current = true;
    setFormError("");
    setNotice("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await apiClient.post(
        `/incidents/${encodeURIComponent(incident.id)}/actions`,
        {
          next,
          version: incident.version,
          assessedDamage: Number(form.get("assessedDamage") || 0),
          thirdPartyCoverage: Number(form.get("thirdPartyCoverage") || 0),
          requestedAmount: Number(form.get("requestedAmount") || 0),
          responsibilityBasis: String(form.get("responsibilityBasis") || ""),
          note: String(form.get("note") || ""),
        },
      );
      setNotice(`Đã cập nhật hồ sơ sự cố: ${next}.`);
      request.reload();
      setSelectedId("");
    } catch (error) {
      setFormError(getErrorMessage(error, "Không thể cập nhật hồ sơ sự cố."));
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }

  async function loadEvents(id) {
    setSelectedId(id);
    setEventsError("");
    const thisRequestId = ++loadEventsRequestId.current;
    setEventsLoading(true);
    try {
      const { data } = await apiClient.get(
        `/incidents/${encodeURIComponent(id)}/events`,
      );
      if (loadEventsRequestId.current !== thisRequestId) {
        return;
      }
      setEventHistory({
        incidentId: id,
        events: Array.isArray(data) ? data : [],
      });
    } catch (error) {
      if (loadEventsRequestId.current !== thisRequestId) {
        return;
      }
      setEventsError(getErrorMessage(error, "Không thể tải lịch sử hồ sơ."));
    } finally {
      if (loadEventsRequestId.current === thisRequestId) {
        setEventsLoading(false);
      }
    }
  }

  return (
    <section className="panel space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Hồ sơ sự cố</h2>
        <p className="mt-1 text-sm text-slate-600">
          Mọi khoản yêu cầu cần có căn cứ; không tự kết luận trách nhiệm hoặc
          khấu trừ tiền cọc.
        </p>
      </div>
      {notice ? <Notice>{notice}</Notice> : null}
      {formError ? <Notice error>{formError}</Notice> : null}
      <RequestState
        loading={request.loading}
        error={request.error}
        onRetry={request.reload}
      >
        {cases.length ? (
          <div className="space-y-3">
            {cases.map((incident) => (
              <article
                className="rounded-xl border border-slate-200 p-4"
                key={incident.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">
                      {incident.kind} · {incident.status}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {incident.description}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Xảy ra {dateTime(incident.occurredAt)} · Báo cáo{" "}
                      {dateTime(incident.reportedAt)}
                    </p>
                    {incident.evidenceReference ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Tài liệu: {incident.evidenceReference}
                      </p>
                    ) : null}
                    {incident.status !== "OPEN" ? (
                      <p className="mt-2 text-sm text-slate-600">
                        Thiệt hại {money(incident.assessedDamage)} · Bên khác
                        chi trả {money(incident.thirdPartyCoverage)} · Yêu cầu{" "}
                        {money(incident.requestedAmount)}
                      </p>
                    ) : null}
                  </div>
                  <button
                    className="btn-secondary"
                    onClick={() => loadEvents(incident.id)}
                  >
                    Lịch sử
                  </button>
                </div>
                {selectedId === incident.id ? (
                  <ol className="mt-3 space-y-2 border-t pt-3 text-sm">
                    {eventsLoading ? (
                      <li role="status">Đang tải lịch sử hồ sơ...</li>
                    ) : eventsError ? (
                      <li role="alert">
                        <p>{eventsError}</p>
                        <button
                          className="btn-secondary mt-2"
                          onClick={() => loadEvents(incident.id)}
                        >
                          Thử tải lại lịch sử
                        </button>
                      </li>
                    ) : selectedEvents.length ? (
                      selectedEvents.map((item, index) => (
                        <li key={`${item.occurred_at}-${index}`}>
                          <p>
                            {item.action} · {dateTime(item.occurred_at)}
                            {item.previous_status || item.next_status
                              ? ` · ${item.previous_status || "Mới"} → ${item.next_status || item.action}`
                              : ""}
                          </p>
                          <p>{item.note}</p>
                          {item.assessed_damage != null ||
                          item.third_party_coverage != null ||
                          item.requested_amount != null ? (
                            <p className="text-xs text-slate-600">
                              Thiệt hại {money(item.assessed_damage ?? 0)} ·
                              Bên khác chi trả{" "}
                              {money(item.third_party_coverage ?? 0)} · Yêu
                              cầu {money(item.requested_amount ?? 0)}
                            </p>
                          ) : null}
                          {item.responsibility_basis ? (
                            <p className="text-xs">
                              Căn cứ trách nhiệm: {item.responsibility_basis}
                            </p>
                          ) : null}
                        </li>
                      ))
                    ) : (
                      <li>Chưa có lịch sử hồ sơ.</li>
                    )}
                  </ol>
                ) : null}
                {(area !== "user" &&
                  ["OPEN", "DISPUTED"].includes(incident.status)) ||
                (area === "admin" && incident.status === "ASSESSED") ? (
                  <form
                    className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2"
                    onSubmit={(event) =>
                      updateIncident(
                        event,
                        incident,
                        incident.status === "ASSESSED" ? "CLAIMED" : "ASSESSED",
                      )
                    }
                  >
                    {incident.status !== "ASSESSED" ? (
                      <>
                        <Field label="Thiệt hại xác minh (VND)">
                          <input
                            name="assessedDamage"
                            type="number"
                            min="0"
                            required
                          />
                        </Field>
                        <Field label="Bảo hiểm/bên khác chi trả (VND)">
                          <input
                            name="thirdPartyCoverage"
                            type="number"
                            min="0"
                            required
                          />
                        </Field>
                        <Field label="Khoản yêu cầu (VND)">
                          <input
                            name="requestedAmount"
                            type="number"
                            min="0"
                            required
                          />
                        </Field>
                        <Field label="Căn cứ trách nhiệm">
                          <input
                            name="responsibilityBasis"
                            required
                            maxLength={1500}
                          />
                        </Field>
                      </>
                    ) : null}
                    <Field label="Ghi chú hồ sơ">
                      <input name="note" required maxLength={1500} />
                    </Field>
                    <button className="btn" disabled={busy}>
                      {incident.status === "ASSESSED"
                        ? "Gửi yêu cầu (Admin)"
                        : "Lưu đánh giá"}
                    </button>
                  </form>
                ) : null}
                {area === "user" && incident.status === "CLAIMED" ? (
                  <form
                    className="mt-4 flex flex-wrap gap-3 border-t pt-4"
                    onSubmit={(event) =>
                      updateIncident(event, incident, "DISPUTED")
                    }
                  >
                    <Field label="Lý do phản hồi">
                      <input name="note" required maxLength={1500} />
                    </Field>
                    <button className="btn-secondary" disabled={busy}>
                      Gửi phản hồi
                    </button>
                  </form>
                ) : null}
                {area === "admin" && incident.status !== "CLOSED" ? (
                  <form
                    className="mt-4 flex flex-wrap gap-3 border-t pt-4"
                    onSubmit={(event) =>
                      updateIncident(event, incident, "CLOSED")
                    }
                  >
                    <Field label="Ghi chú đóng hồ sơ">
                      <input name="note" required maxLength={1500} />
                    </Field>
                    <button className="btn-secondary" disabled={busy}>
                      Đóng hồ sơ
                    </button>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="Chưa có hồ sơ sự cố" />
        )}
      </RequestState>
      {canReport ? (
        <form
          className="grid gap-3 border-t pt-4 sm:grid-cols-2"
          onSubmit={report}
        >
          <Field label="Loại sự cố">
            <select name="kind">
              <option value="DAMAGE">Hư hỏng</option>
              <option value="ACCIDENT">Tai nạn</option>
              <option value="VIOLATION">Vi phạm</option>
            </select>
          </Field>
          <Field label="Thời điểm xảy ra">
            <input
              name="occurredAt"
              type="datetime-local"
              required
              min={custodyStart || undefined}
              max={custodyEnd}
              defaultValue={custodyEnd}
            />
          </Field>
          <p className="text-xs text-slate-500 sm:col-span-2">
            {custodyStart
              ? `Thời điểm phải thuộc thời gian giữ xe thực tế: từ ${dateTime(handoverRecord.occurred_at)} đến ${returnRecord ? dateTime(returnRecord.occurred_at) : "hiện tại"}. Backend vẫn kiểm tra lại theo biên bản.`
              : "Cần có biên bản giao xe thực tế để xác định thời gian sự cố hợp lệ."}
          </p>
          <Field label="Mô tả có căn cứ">
            <textarea name="description" required maxLength={1500} />
          </Field>
          <Field label="Mã/tài liệu tham chiếu (không tải tệp)">
            <input name="evidenceReference" maxLength={2000} />
          </Field>
          {area !== "user" ? (
            <label className="flex gap-3 text-sm">
              <input name="blockVehicle" type="checkbox" /> Đưa xe vào bảo trì
            </label>
          ) : null}
          <button className="btn" disabled={busy}>
            Lập hồ sơ sự cố
          </button>
        </form>
      ) : null}
    </section>
  );
}

export function ApiHomePage() {
  const { user: currentUser } = useAuth();
  const vehiclesRequest = useApiData("/vehicles");
  const catalogRequest = useApiData("/vehicles/catalog");
  const [query, setQuery] = useState("");

  const vehicles = useMemo(() => {
    const rawList = Array.isArray(vehiclesRequest.data)
      ? vehiclesRequest.data
      : [];
    const normalized = rawList.map((vehicle) =>
      normalizeVehicle(vehicle, catalogRequest.data),
    );
    const filtered = query.trim()
      ? normalized.filter((vehicle) =>
          `${vehicle.name} ${vehicle.brand} ${vehicle.plate}`
            .toLocaleLowerCase("vi")
            .includes(query.trim().toLocaleLowerCase("vi")),
        )
      : normalized;

    // Sắp xếp xác định: theo tên tăng dần, sau đó theo ID
    const sorted = [...filtered].sort((a, b) => {
      const nameComp = a.name.localeCompare(b.name, "vi");
      if (nameComp !== 0) return nameComp;
      return String(a.id).localeCompare(String(b.id));
    });

    return sorted.slice(0, 6);
  }, [vehiclesRequest.data, catalogRequest.data, query]);

  const loading = vehiclesRequest.loading || catalogRequest.loading;
  const error = vehiclesRequest.error || catalogRequest.error;
  const retry = () => {
    vehiclesRequest.reload();
    catalogRequest.reload();
  };

  const isUser = currentUser?.role === "USER";

  return (
    <div className="page-shell">
      <section className="urban-hero">
        <div className="urban-hero-copy">
          <p className="urban-kicker">KDRIVE · THUÊ XE TỰ LÁI</p>
          <h1>Mỗi chuyến đi,<br /><em>một câu chuyện.</em></h1>
          <p className="urban-intro">Tự do chọn hành trình. Tìm chiếc xe phù hợp, chọn điểm nhận và trả, khám phá theo cách của bạn.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link className="btn" to="/vehicles">Xem toàn bộ xe ↗</Link>
            {isUser ? <Link className="btn-secondary" to="/user/bookings">Đơn thuê của tôi</Link> : !currentUser ? <Link className="btn-secondary" to="/register">Đăng ký tài khoản</Link> : null}
            {isUser ? <Link className="btn-secondary" to="/user/profile">Hồ sơ &amp; GPLX</Link> : null}
          </div>
          <p className="urban-smallprint">Giá theo block 24 giờ · Nhận / trả theo tuyến chi nhánh</p>
        </div>
        <div className="urban-hero-photo">
          {!loading && !error && vehicles[0] ? <VehicleGallery vehicle={vehicles[0]} /> : <div className="urban-photo-empty">Hành trình của bạn bắt đầu tại đây.</div>}
          <div className="urban-photo-caption"><span>ĐỒNG HÀNH CÙNG BẠN</span><strong>{!loading && !error ? vehicles[0]?.name || "Khám phá danh mục xe" : "Khám phá danh mục xe"}</strong>{vehicles[0]?.images?.length ? <small>Ảnh minh họa mẫu xe</small> : null}</div>
        </div>
      </section>
      <section className="urban-promises" aria-label="Thông tin thuê xe">
        <div><span>01 / MINH BẠCH</span><h2>Giá rõ ràng</h2><p>Giá niêm yết từ hệ thống; báo giá kiểm tra lịch, tuyến và giá trước khi gửi yêu cầu.</p></div>
        <div><span>02 / LINH HOẠT</span><h2>Chọn tuyến phù hợp</h2><p>Nhận và trả tại các chi nhánh theo tuyến đang được hỗ trợ.</p></div>
        <div><span>03 / CHỦ ĐỘNG</span><h2>Theo dõi đơn thuê</h2><p>Xem trạng thái, thời gian thuê và chứng từ của bạn tại một nơi.</p></div>
      </section>
      <div className="urban-section-heading"><div><p className="urban-kicker">DÀNH CHO HÀNH TRÌNH TIẾP THEO</p><h2>Chiếc xe của bạn.</h2></div><Link to="/vehicles" className="btn-secondary">Khám phá danh mục →</Link></div>

      {/* Danh sách xe nổi bật và Search bar */}
      <section className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-md flex-1">
            <Field label="Tìm kiếm theo tên xe hoặc hãng">
              <input
                type="search"
                placeholder="Nhập tên xe, hãng xe (ví dụ: Vios, Accent)..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </Field>
          </div>
          <div className="text-sm font-medium text-slate-500">
            {query.trim() ? (
              <span>Kết quả tìm kiếm ({vehicles.length})</span>
            ) : (
              <span>Hiển thị tối đa 6 xe</span>
            )}
          </div>
        </div>

        <RequestState loading={loading} error={error} onRetry={retry}>
          {vehicles.length > 0 ? (
            <div>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {vehicles.map((vehicle) => (
                  <VehicleCard key={vehicle.id} vehicle={vehicle} />
                ))}
              </div>
              <div className="mt-8 flex justify-center border-t border-slate-200 pt-6">
                <Link
                  className="btn-secondary inline-flex items-center gap-2 px-6 py-2.5 font-medium"
                  to="/vehicles"
                >
                  Xem tất cả xe trong hệ thống <span>→</span>
                </Link>
              </div>
            </div>
          ) : (
            <EmptyState
              title={query.trim() ? "Không tìm thấy xe phù hợp" : "Chưa có xe nào trong hệ thống"}
              description={
                query.trim()
                  ? "Thử tìm kiếm với từ khóa khác hoặc duyệt danh mục xe đầy đủ."
                  : "Hệ thống hiện chưa có danh sách xe khai thác."
              }
              action={
                query.trim() ? (
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setQuery("")}
                    >
                      Xóa từ khóa tìm kiếm
                    </button>
                    <Link className="btn" to="/vehicles">
                      Duyệt danh sách đầy đủ
                    </Link>
                  </div>
                ) : (
                  <button type="button" className="btn-secondary" onClick={retry}>
                    Tải lại danh sách
                  </button>
                )
              }
            />
          )}
        </RequestState>
      </section>
    </div>
  );
}

export function ApiVehicleListPage() {
  const vehiclesRequest = useApiData("/vehicles");
  const catalogRequest = useApiData("/vehicles/catalog");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [seats, setSeats] = useState("");
  const [transmission, setTransmission] = useState("");
  const [sort, setSort] = useState("");
  const vehicles = useMemo(() => {
    const rows = (
      Array.isArray(vehiclesRequest.data) ? vehiclesRequest.data : []
    )
      .map((vehicle) => normalizeVehicle(vehicle, catalogRequest.data))
      .filter(
        (vehicle) =>
          (!query ||
            `${vehicle.name} ${vehicle.brand} ${vehicle.plate}`
              .toLocaleLowerCase("vi")
              .includes(query.toLocaleLowerCase("vi"))) &&
          (!status || vehicle.status === status) &&
          (!category || vehicle.categoryId === category) &&
          (!seats || vehicle.seats >= Number(seats)) &&
          (!transmission || vehicle.transmission === transmission),
      );
    return rows.sort((a, b) =>
      sort === "price-asc"
        ? a.price - b.price
        : sort === "price-desc"
          ? b.price - a.price
          : a.name.localeCompare(b.name, "vi"),
    );
  }, [
    vehiclesRequest.data,
    catalogRequest.data,
    query,
    status,
    category,
    seats,
    transmission,
    sort,
  ]);
  const loading = vehiclesRequest.loading || catalogRequest.loading;
  const error = vehiclesRequest.error || catalogRequest.error;
  const retry = () => {
    vehiclesRequest.reload();
    catalogRequest.reload();
  };
  return (
    <Page
      title="Danh sách xe"
      description="Lọc xe theo tên, hãng hoặc trạng thái khai thác."
    >
      <div className="urban-filter mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Tìm xe">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
        <Field label="Tình trạng khai thác">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Tất cả</option>
            <option value="ACTIVE">Đang khai thác</option>
            <option value="MAINTENANCE">Bảo trì</option>
            <option value="INACTIVE">Ngừng khai thác</option>
          </select>
        </Field>
        <Field label="Loại xe">
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">Tất cả loại xe</option>
            {(catalogRequest.data?.categories || []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Số chỗ tối thiểu">
          <select
            value={seats}
            onChange={(event) => setSeats(event.target.value)}
          >
            <option value="">Không giới hạn</option>
            {[2, 4, 5, 7, 9].map((count) => (
              <option key={count} value={count}>
                {count} chỗ
              </option>
            ))}
          </select>
        </Field>
        <Field label="Hộp số">
          <select
            value={transmission}
            onChange={(event) => setTransmission(event.target.value)}
          >
            <option value="">Tất cả</option>
            <option value="Tự động">Tự động</option>
            <option value="Số sàn">Số sàn</option>
          </select>
        </Field>
        <Field label="Sắp xếp">
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="">Tên xe</option>
            <option value="price-asc">Giá thấp trước</option>
            <option value="price-desc">Giá cao trước</option>
          </select>
        </Field>
      </div>
      <RequestState loading={loading} error={error} onRetry={retry}>
        {vehicles.length ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {vehicles.map((vehicle) => (
              <VehicleCard key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Không tìm thấy xe"
            description="Thử đổi từ khóa hoặc bỏ bộ lọc trạng thái."
            action={
              <button
                className="btn-secondary"
                onClick={() => {
                  setQuery("");
                  setStatus("");
                  setCategory("");
                  setSeats("");
                  setTransmission("");
                  setSort("");
                }}
              >
                Xóa bộ lọc
              </button>
            }
          />
        )}
      </RequestState>
      <p className="mt-5 text-xs text-slate-500">
        Lịch còn trống được xác nhận qua báo giá trên máy chủ; trạng thái xe
        không thay thế kiểm tra thời gian và tuyến nhận/trả.
      </p>
    </Page>
  );
}

export function ApiVehicleDetailPage() {
  const { vehicleId } = useParams();
  const vehicleRequest = useApiData(
    `/vehicles/${encodeURIComponent(vehicleId)}`,
  );
  const catalogRequest = useApiData("/vehicles/catalog");
  const vehicleReviewsRequest = useApiData(
    `/vehicles/${encodeURIComponent(vehicleId)}/reviews`,
  );
  const vehicle = vehicleRequest.data
    ? normalizeVehicle(vehicleRequest.data, catalogRequest.data)
    : null;
  const loading = vehicleRequest.loading || catalogRequest.loading;
  const error = vehicleRequest.error || catalogRequest.error;
  return (
    <Page title={vehicle?.name || "Chi tiết xe"}>
      <RequestState
        loading={loading}
        error={error}
        onRetry={() => {
          vehicleRequest.reload();
          catalogRequest.reload();
        }}
      >
        {!vehicle ? (
          <Missing title="Không tìm thấy xe" back="/vehicles" />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <section className="panel">
              <VehicleGallery vehicle={vehicle} />
              <h2 className="mt-5 text-xl font-semibold">{vehicle.name}</h2>
              <p className="mt-2 text-sm text-slate-600">
                {vehicle.brand} · {vehicle.category} · {vehicle.seats} chỗ ·{" "}
                {vehicle.transmission}
              </p>
              <p className="mt-4 leading-7 text-slate-700">
                {vehicle.description || "Chưa có mô tả cho xe này."}
              </p>
              <p className="mt-4 text-sm text-slate-600">
                Chi nhánh hiện tại: {vehicle.currentBranchId || "Chưa xác định"}
              </p>
              {vehicle.amenities && vehicle.amenities.length > 0 ? (
                <div className="mt-5 border-t border-slate-100 pt-5">
                  <h3 className="mb-3 text-sm font-semibold text-slate-700">
                    Tiện nghi ({vehicle.amenities.length})
                  </h3>
                  <ul className="flex flex-wrap gap-2">
                    {vehicle.amenities.map((a) => (
                      <li
                        key={a.id}
                        className="inline-flex items-center gap-1 rounded-md bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800"
                      >
                        {a.name}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-5 border-t border-slate-100 pt-5 text-sm text-slate-500">
                  Xe chưa có thông tin tiện nghi.
                </p>
              )}
            </section>
            <aside className="panel h-fit">
              <VehicleOperationalStatus status={vehicle.status} />
              <p className="mt-4 text-2xl font-bold text-teal-800">
                {money(vehicle.price)}{" "}
                <span className="text-sm font-normal">/ 24 giờ</span>
              </p>
              <p className="mt-3 text-sm text-slate-600">
                Báo giá sẽ kiểm tra lịch xe, tuyến chi nhánh và giá hiện tại.
              </p>
              {vehicle.status === "ACTIVE" ? (
                <Link
                  className="btn mt-5 w-full"
                  to={`/user/bookings/new?vehicleId=${encodeURIComponent(vehicle.id)}`}
                >
                  Kiểm tra giá & lịch
                </Link>
              ) : null}
            </aside>
            <section className="panel lg:col-span-2">
              <h2 className="mb-4 text-lg font-semibold">
                Đánh giá của khách hàng
              </h2>
              <RequestState
                loading={vehicleReviewsRequest.loading}
                error={vehicleReviewsRequest.error}
                onRetry={vehicleReviewsRequest.reload}
              >
                {vehicleReviewsRequest.data?.length ? (
                  <div className="space-y-4">
                    {vehicleReviewsRequest.data.map((review) => (
                      <article
                        className="border-t border-slate-100 pt-4"
                        key={review.id}
                      >
                        <p className="font-semibold">{review.rating}/5 sao</p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">
                          {review.content}
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          {dateTime(review.created_at)}
                        </p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    Xe chưa có đánh giá công khai.
                  </p>
                )}
              </RequestState>
            </section>
          </div>
        )}
      </RequestState>
    </Page>
  );
}

function toVietnamInput(days) {
  return new Date(Date.now() + days * 86400000 + 7 * 3600000)
    .toISOString()
    .slice(0, 16);
}

export function ApiNewBookingPage() {
  const [params] = useSearchParams();
  const vehicleId = params.get("vehicleId") || "";
  const vehicleRequest = useApiData(
    `/vehicles/${encodeURIComponent(vehicleId)}`,
    Boolean(vehicleId),
  );
  const branchesRequest = useApiData("/branches");
  const routesRequest = useApiData("/branch-routes");
  const [start, setStart] = useState(
    () => params.get("start") || toVietnamInput(3),
  );
  const [end, setEnd] = useState(() => params.get("end") || toVietnamInput(4));
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [quoteValue, setQuote] = useState(null);
  const [quoteInput, setQuoteInput] = useState(null);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const [quoteRequestGeneration] = useState(createRequestGeneration);
  const branches = (branchesRequest.data || []).filter(
    (branch) => branch.status === "ACTIVE",
  );
  const routes = (routesRequest.data || []).filter(
    (route) => route.enabled && route.pickupBranchId === pickup,
  );
  const normalized = vehicleRequest.data
    ? normalizeVehicle(vehicleRequest.data, null)
    : null;
  const pickupInitialized = useRef(false);
  const dropoffInitialized = useRef(false);

  useEffect(() => {
    if (pickupInitialized.current || pickup || !branches.length) return;
    pickupInitialized.current = true;
    setPickup(branches[0].id);
  }, [branches, pickup]);
  useEffect(() => {
    if (
      dropoffInitialized.current ||
      !routes.length ||
      routes.some((route) => route.returnBranchId === dropoff)
    )
      return;
    dropoffInitialized.current = true;
    setDropoff(routes[0].returnBranchId);
  }, [routes, dropoff]);
  useLayoutEffect(() => {
    quoteRequestGeneration.invalidate();
  }, [quoteRequestGeneration, vehicleId]);

  function getCurrentInput() {
    return {
      vehicleId,
      pickupBranchId: pickup,
      returnBranchId: dropoff,
      startAt: toUTC(start),
      endAt: toUTC(end),
    };
  }

  const quote =
    quoteInput && sameBookingInput(getCurrentInput(), quoteInput)
      ? quoteValue
      : null;

  function inputChanged(input) {
    return !sameBookingInput(input, quoteInput);
  }

  function updateQuoteField(field, setter, value) {
    quoteRequestGeneration.invalidate();
    setQuote(null);
    setQuoteInput(null);
    setAccepted(false);
    setError("");
    setBusy(false);
    setter(value);
  }

  async function checkQuote(event) {
    event.preventDefault();
    setError("");
    setAccepted(false);
    setBusy(true);

    const input = getCurrentInput();
    const thisRequestId = quoteRequestGeneration.begin();
    setQuote(null);
    setQuoteInput(input);

    try {
      const result = await quoteBooking(input);
      if (
        !quoteRequestIsCurrent(
          quoteRequestGeneration,
          thisRequestId,
          input,
          getCurrentInput(),
        )
      ) return;
      setQuote(result);
    } catch (requestError) {
      if (
        quoteRequestIsCurrent(
          quoteRequestGeneration,
          thisRequestId,
          input,
          getCurrentInput(),
        )
      ) {
        setError(
          getErrorMessage(requestError, "Không thể kiểm tra giá và lịch xe."),
        );
      }
    } finally {
      if (quoteRequestGeneration.isCurrent(thisRequestId)) {
        setBusy(false);
      }
    }
  }

  async function submitBooking() {
    if (!quote || !accepted || busy) return;
    if (inputChanged(getCurrentInput())) {
      setError("Thông tin đã thay đổi. Vui lòng kiểm tra lại báo giá.");
      setQuote(null);
      setQuoteInput(null);
      setAccepted(false);
      return;
    }
    setError("");
    setBusy(true);
    setSubmitting(true);
    try {
      const currentInput = getCurrentInput();
      const booking = await createBooking({
        ...currentInput,
        expectedTotal: quote.total,
      });
      navigate(`/user/bookings/${booking.id}`, {
        replace: true,
        state: { created: true },
      });
    } catch (requestError) {
      setQuote(null);
      setQuoteInput(null);
      setAccepted(false);
      setError(getErrorMessage(requestError, "Không thể tạo yêu cầu thuê."));
    } finally {
      setBusy(false);
      setSubmitting(false);
    }
  }

  const loading =
    vehicleRequest.loading || branchesRequest.loading || routesRequest.loading;
  const loadError =
    vehicleRequest.error || branchesRequest.error || routesRequest.error;
  return (
    <Page
      title="Tạo yêu cầu thuê"
      description="Chọn thời gian và tuyến nhận/trả. Báo giá cuối cùng do máy chủ xác nhận."
      actions={
        <Link className="btn-secondary" to="/vehicles">
          Quay lại danh sách xe
        </Link>
      }
    >
      <RequestState
        loading={loading}
        error={loadError}
        onRetry={() => {
          vehicleRequest.reload();
          branchesRequest.reload();
          routesRequest.reload();
        }}
      >
        {!normalized ? (
          <Missing title="Không tìm thấy xe để đặt" />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="space-y-5">
              <form className="panel space-y-5" onSubmit={checkQuote}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Thời gian nhận (giờ Việt Nam)">
                    <input
                      type="datetime-local"
                      required
                      disabled={submitting}
                      min={toVietnamInput(0)}
                      value={start}
                      onChange={(event) => {
                        updateQuoteField("start", setStart, event.target.value);
                      }}
                    />
                  </Field>
                  <Field label="Thời gian trả (giờ Việt Nam)">
                    <input
                      type="datetime-local"
                      required
                      disabled={submitting}
                      min={start}
                      value={end}
                      onChange={(event) => {
                        updateQuoteField("end", setEnd, event.target.value);
                      }}
                    />
                  </Field>
                  <Field label="Chi nhánh nhận xe">
                    <select
                      required
                      disabled={submitting}
                      value={pickup}
                      onChange={(event) => {
                        updateQuoteField(
                          "pickup",
                          setPickup,
                          event.target.value,
                        );
                      }}
                    >
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name} · {branch.address}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Chi nhánh trả xe">
                    <select
                      required
                      disabled={submitting}
                      value={dropoff}
                      onChange={(event) => {
                        updateQuoteField(
                          "dropoff",
                          setDropoff,
                          event.target.value,
                        );
                      }}
                    >
                      {routes.map((route) => {
                        const branch = branches.find(
                          (item) => item.id === route.returnBranchId,
                        );
                        return branch ? (
                          <option key={route.id} value={route.returnBranchId}>
                            {branch.name} · phí tuyến {money(route.fee)}
                          </option>
                        ) : null;
                      })}
                    </select>
                  </Field>
                </div>
                {!routes.length ? (
                  <Notice error>
                    Không có tuyến trả xe đang mở từ chi nhánh nhận đã chọn.
                    Chọn chi nhánh khác hoặc liên hệ quản trị viên.
                  </Notice>
                ) : null}
                {error ? <Notice error>{error}</Notice> : null}
                {error.toLocaleLowerCase("vi").includes("gplx") ? (
                  <Link className="btn-secondary" to="/user/profile">
                    Cập nhật giấy phép lái xe
                  </Link>
                ) : null}
                <button className="btn" disabled={busy || !routes.length}>
                  {busy ? "Đang kiểm tra..." : "Kiểm tra lịch & báo giá"}
                </button>
              </form>
              {quote ? (
                <section className="panel space-y-4">
                  <h2 className="text-lg font-semibold">Báo giá xác nhận</h2>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt>
                        {quote.rentalDays} ngày × {money(quote.dailyPrice)}
                      </dt>
                      <dd>{money(quote.rentalTotal)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt>Phí tuyến một chiều</dt>
                      <dd>{money(quote.oneWayFee)}</dd>
                    </div>
                    <div className="flex justify-between gap-4 border-t pt-3 text-base font-bold">
                      <dt>Tổng báo giá</dt>
                      <dd>{money(quote.total)}</dd>
                    </div>
                  </dl>
                  <p className="text-sm text-slate-600">
                    {quote.pickupName} → {quote.returnName}. Giá và khả dụng
                    được kiểm tra lại khi gửi; yêu cầu chỉ được tạo nếu báo giá
                    còn khớp.
                  </p>
                  <p className="text-xs text-slate-500">
                    Tiền cọc hoặc khoản chưa được cấu hình không nằm trong báo
                    giá này. Tổng báo giá không xác nhận thanh toán.
                  </p>
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(event) => setAccepted(event.target.checked)}
                    />
                    Tôi xác nhận thời gian, chi nhánh và tổng báo giá.
                  </label>
                  <button
                    className="btn"
                    disabled={!accepted || busy}
                    onClick={submitBooking}
                  >
                    {busy ? "Đang gửi..." : "Gửi yêu cầu thuê"}
                  </button>
                </section>
              ) : null}
            </div>
            <aside className="panel h-fit">
              <VehicleVisual vehicle={normalized} />
              <h2 className="mt-4 text-xl font-bold">{normalized.name}</h2>
              <p className="mt-2 text-sm text-slate-500">
                {normalized.seats} chỗ · {normalized.transmission}
              </p>
            </aside>
          </div>
        )}
      </RequestState>
    </Page>
  );
}

export function ApiBookingListPage({ area = "user", mode = "all" }) {
  const request = useApiData("/bookings");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(
    mode === "handover" ? "CONFIRMED" : mode === "return" ? "IN_PROGRESS" : "",
  );
  const rows = (Array.isArray(request.data) ? request.data : []).filter(
    (booking) => {
      const text =
        `${booking.id} ${booking.vehicleName} ${booking.customerName || ""}`.toLocaleLowerCase(
          "vi",
        );
      return (
        (!status || booking.status === status) &&
        text.includes(query.toLocaleLowerCase("vi"))
      );
    },
  );
  const title =
    area === "user"
      ? "Đơn thuê của tôi"
      : area === "admin"
        ? "Tra cứu đơn thuê"
        : mode === "handover"
          ? "Bàn giao xe"
          : mode === "return"
            ? "Nhận trả xe"
            : "Hàng đợi xử lý";
  return (
    <Page
      title={title}
      description="Thông tin và trạng thái được tải trực tiếp từ hệ thống."
    >
      <div className="urban-filter mb-6 grid gap-4 sm:grid-cols-2">
        <Field label="Tìm mã đơn, xe hoặc khách hàng">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
        <Field label="Trạng thái">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Tất cả</option>
            {[
              "PENDING",
              "CONFIRMED",
              "IN_PROGRESS",
              "RETURNED",
              "COMPLETED",
              "CANCELLED",
              "REJECTED",
              "EXPIRED",
            ].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <RequestState
        loading={request.loading}
        error={request.error}
        onRetry={request.reload}
      >
        {rows.length ? (
          <div className="space-y-4">
            {rows.map((booking) => (
              <article
                className={`panel flex flex-wrap items-center justify-between gap-4 ${area === "user" ? "urban-booking-card" : ""}`}
                key={booking.id}
              >
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <span className="text-xs font-semibold text-slate-500">
                      {booking.id}
                    </span>
                    <Status status={booking.status} />
                  </div>
                  <h2 className="font-semibold">{booking.vehicleName}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {dateTime(booking.startAt)} → {dateTime(booking.endAt)}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {booking.pickupName} → {booking.returnName}
                  </p>
                  {area !== "user" ? (
                    <p className="mt-1 text-sm text-slate-500">
                      {booking.customerName}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-4">
                  <strong>{money(booking.total)}</strong>
                  <Link
                    className="btn-secondary"
                    to={
                      mode === "handover" && booking.status === "CONFIRMED"
                        ? `/staff/handover/${booking.id}`
                        : mode === "return" && booking.status === "IN_PROGRESS"
                          ? `/staff/return/${booking.id}`
                          : `/${area}/bookings/${booking.id}`
                    }
                  >
                    Chi tiết
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Không có đơn phù hợp"
            description="Thử thay đổi từ khóa hoặc trạng thái."
          />
        )}
      </RequestState>
    </Page>
  );
}

export function BookingReviewSection({
  booking,
  area = "user",
  bookingReviewRequest,
  submitReview,
  rating,
  setRating,
  review,
  setReview,
  reviewBusy,
}) {
  if (area !== "user" || booking?.status !== "COMPLETED") return null;

  if (bookingReviewRequest.loading) {
    return (
      <section className="panel space-y-2">
        <p role="status">Đang tải đánh giá...</p>
        <LoadingSkeleton rows={2} />
      </section>
    );
  }

  if (bookingReviewRequest.error) {
    return (
      <section className="panel space-y-2">
        <Notice error>{bookingReviewRequest.error}</Notice>
        <button
          className="btn-secondary"
          onClick={bookingReviewRequest.reload}
          type="button"
        >
          Thử tải lại đánh giá
        </button>
      </section>
    );
  }

  if (bookingReviewRequest.data) {
    return (
      <section className="panel space-y-2">
        <h2 className="text-lg font-semibold">Đánh giá của bạn</h2>
        <p className="font-semibold text-amber-600">
          {bookingReviewRequest.data.rating}/5 sao
        </p>
        <p className="whitespace-pre-line text-sm leading-6 text-slate-700">
          {bookingReviewRequest.data.content}
        </p>
        <p className="text-xs text-slate-500">
          {dateTime(bookingReviewRequest.data.created_at)}
          {bookingReviewRequest.data.hidden ? " • (Đang ẩn bởi kiểm duyệt)" : ""}
        </p>
      </section>
    );
  }

  return (
    <form className="panel space-y-4" onSubmit={submitReview}>
      <h2 className="text-lg font-semibold">Đánh giá chuyến thuê</h2>
      <Field label="Mức hài lòng">
        <select
          value={rating}
          onChange={(event) => setRating(event.target.value)}
        >
          {[5, 4, 3, 2, 1].map((value) => (
            <option key={value} value={value}>
              {value} sao
            </option>
          ))}
        </select>
      </Field>
      <Field label="Nội dung">
        <textarea
          required
          maxLength={1000}
          rows={4}
          value={review}
          onChange={(event) => setReview(event.target.value)}
        />
      </Field>
      <button className="btn" disabled={reviewBusy}>
        {reviewBusy ? "Đang gửi..." : "Gửi đánh giá"}
      </button>
    </form>
  );
}

export function ApiBookingDetailPage({ area = "user" }) {
  const { bookingId } = useParams();
  const request = useApiData(`/bookings/${encodeURIComponent(bookingId)}`);
  const bookingReviewRequest = useApiData(
    `/bookings/${encodeURIComponent(bookingId)}/review`,
    area === "user",
  );
  const { user: currentUser } = useAuth();
  const isStaff = currentUser?.role === "STAFF";
  const branchAssignmentsRequest = useApiData("/me/branches", isStaff);
  const [next, setNext] = useState("");
  const [reason, setReason] = useState("");
  const [condition, setCondition] = useState("");
  const [licenseChecked, setLicenseChecked] = useState(false);
  const [maintenance, setMaintenance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rating, setRating] = useState("5");
  const [review, setReview] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const detail = request.data || {};
  const booking = detail.booking;
  const license = detail.license;
  const assignedBranchIds = new Set(
    Array.isArray(branchAssignmentsRequest.data)
      ? branchAssignmentsRequest.data
      : [],
  );
  const now = useNow();
  const prevBookingId = useRef(booking?.id);

  useEffect(() => {
    if (prevBookingId.current === booking?.id) return;
    prevBookingId.current = booking?.id;
    setNext("");
    setReason("");
    setCondition("");
    setLicenseChecked(false);
    setMaintenance(false);
    setError("");
    setNotice("");
  }, [booking?.id]);

  const availableActions = getBookingActions(booking, {
    role: currentUser?.role,
    assignedBranchIds,
    assignmentsReady:
      !isStaff ||
      (!branchAssignmentsRequest.loading && !branchAssignmentsRequest.error),
    now,
  });

  async function submitAction(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await applyBookingAction(booking.id, {
        next,
        version: booking.version,
        reason: reason || null,
        condition: condition || null,
        licenseChecked,
        maintenance,
      });
      setNotice("Đã cập nhật trạng thái đơn.");
      setNext("");
      setReason("");
      setCondition("");
      request.reload();
    } catch (actionError) {
      setError(getErrorMessage(actionError, "Không thể cập nhật đơn."));
      if (actionError.response?.status === 409) request.reload();
    } finally {
      setBusy(false);
    }
  }

  async function submitReview(event) {
    event.preventDefault();
    if (reviewBusy) return;
    setError("");
    setNotice("");
    setReviewBusy(true);
    try {
      await apiClient.post("/reviews", {
        bookingId: booking.id,
        rating: Number(rating),
        content: review,
      });
      setNotice("Đã gửi đánh giá cho đơn hoàn tất.");
      setReview("");
      bookingReviewRequest.reload();
    } catch (reviewError) {
      setError(
        getErrorMessage(
          reviewError,
          "Chỉ gửi được một đánh giá từ 1 đến 5 sao cho đơn hoàn tất.",
        ),
      );
    } finally {
      setReviewBusy(false);
    }
  }

  return (
    <Page
      title={booking ? `Đơn ${booking.id}` : "Chi tiết đơn thuê"}
      description={booking?.vehicleName}
      actions={
        <Link className="btn-secondary" to={`/${area}/bookings`}>
          Quay lại danh sách
        </Link>
      }
    >
      <RequestState
        loading={request.loading}
        error={request.error}
        onRetry={request.reload}
      >
        {!booking ? (
          <Missing title="Không tìm thấy đơn" back={`/${area}/bookings`} />
        ) : (
          <>
            {notice ? <Notice>{notice}</Notice> : null}
            <div className="mb-5 flex items-center gap-3">
              <Status status={booking.status} />
              <span className="text-sm text-slate-500">
                Phiên bản {booking.version}
              </span>
            </div>
            {booking.status === "PENDING" && booking.expiresAt ? (
              <p className="mb-5 text-sm text-amber-800">
                Yêu cầu giữ lịch đến {dateTime(booking.expiresAt)}.
              </p>
            ) : null}
            {error ? <Notice error>{error}</Notice> : null}
            <div className="grid gap-6 lg:grid-cols-[1fr_330px]">
              <div className="space-y-5">
                <section className="panel">
                  <h2 className="mb-4 text-lg font-semibold">Thông tin thuê</h2>
                  <dl className="grid gap-4 text-sm sm:grid-cols-2">
                    {[
                      ["Khách hàng", booking.customerName],
                      ["Xe", booking.vehicleName],
                      ["Thời gian nhận", dateTime(booking.startAt)],
                      ["Thời gian trả", dateTime(booking.endAt)],
                      ["Chi nhánh nhận", booking.pickupName],
                      [
                        "Chi nhánh trả",
                        booking.actualReturnBranchId
                          ? `${booking.returnName} · đã nhận`
                          : booking.returnName,
                      ],
                      [
                        "Giá thuê",
                        `${booking.rentalDays} ngày × ${money(booking.dailyPrice)}`,
                      ],
                      ["Phí tuyến", money(booking.oneWayFee)],
                      ["Tổng tiền snapshot", money(booking.total)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-slate-500">{label}</dt>
                        <dd className="mt-1 font-semibold">{value || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-4 text-xs text-slate-500">
                    Tổng tiền không xác nhận đã thanh toán.
                  </p>
                </section>
                <section className="panel">
                  <h2 className="mb-4 text-lg font-semibold">
                    Lịch sử trạng thái
                  </h2>
                  {detail.history?.length ? (
                    <ol className="space-y-3">
                      {detail.history.map((event, index) => (
                        <li
                          className="border-l-2 border-teal-200 pl-4 text-sm"
                          key={`${event.occurred_at}-${index}`}
                        >
                          <p className="font-semibold">
                            {event.previous_status || "Mới"} →{" "}
                            {event.next_status}
                          </p>
                          <p className="mt-1 text-slate-500">
                            {dateTime(event.occurred_at)}
                          </p>
                          {event.reason ? (
                            <p className="mt-1">{event.reason}</p>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-sm text-slate-500">
                      Chưa có lịch sử trạng thái.
                    </p>
                  )}
                </section>
                {detail.records?.length ? (
                  <section className="panel">
                    <h2 className="mb-4 text-lg font-semibold">
                      Biên bản giao nhận
                    </h2>
                    <div className="space-y-4">
                      {detail.records.map((record, index) => (
                        <article
                          className="border-t border-slate-100 pt-4"
                          key={`${record.kind}-${index}`}
                        >
                          <h3 className="font-semibold">
                            {record.kind === "HANDOVER"
                              ? "Giao xe"
                              : "Nhận trả xe"}
                          </h3>
                          <p className="mt-1 text-sm text-slate-500">
                            {dateTime(record.occurred_at)}
                          </p>
                          <p className="mt-2 text-sm leading-6">
                            {record.condition_note}
                          </p>
                          {record.maintenance ? (
                            <p className="mt-2 text-sm text-amber-800">
                              Đã chuyển tình trạng xe sang bảo trì.
                            </p>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}
                <section className="panel">
                  <h2 className="mb-4 text-lg font-semibold">Hồ sơ đơn</h2>
                  <div className="flex flex-wrap gap-3">
                    <Link
                      className="btn-secondary"
                      to={`/${area}/bookings/${booking.id}/contract`}
                    >
                      Hợp đồng
                    </Link>
                    <Link
                      className="btn-secondary"
                      to={`/${area}/bookings/${booking.id}/invoice`}
                    >
                      Hóa đơn
                    </Link>
                  </div>
                </section>
                <BookingReviewSection
                  booking={booking}
                  area={area}
                  bookingReviewRequest={bookingReviewRequest}
                  submitReview={submitReview}
                  rating={rating}
                  setRating={setRating}
                  review={review}
                  setReview={setReview}
                  reviewBusy={reviewBusy}
                />
                <IncidentSection
                  booking={booking}
                  records={detail.records || []}
                  area={area}
                />
              </div>
              <div className="space-y-4">
                {isStaff && branchAssignmentsRequest.loading ? (
                  <p role="status" className="panel text-sm text-slate-600">
                    Đang tải phân công chi nhánh...
                  </p>
                ) : null}
                {isStaff && branchAssignmentsRequest.error ? (
                  <section className="panel space-y-3">
                    <Notice error>{branchAssignmentsRequest.error}</Notice>
                    <button
                      className="btn-secondary"
                      onClick={branchAssignmentsRequest.reload}
                    >
                      Tải lại phân công
                    </button>
                  </section>
                ) : null}
                {isStaff &&
                !branchAssignmentsRequest.loading &&
                !branchAssignmentsRequest.error &&
                !assignedBranchIds.size ? (
                  <Notice error>
                    Tài khoản Staff chưa được phân công chi nhánh; không có
                    thao tác vận hành khả dụng.
                  </Notice>
                ) : null}
                {isStaff && license ? (
                  <section className="panel">
                    <h2 className="mb-4 text-lg font-semibold">
                      GPLX khách hàng
                    </h2>
                    <dl className="grid gap-3 text-sm">
                      <div>
                        <dt className="text-slate-500">Số GPLX</dt>
                        <dd className="mt-1 font-semibold font-mono">
                          {license.licenseNumber}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Hệ / Hạng</dt>
                        <dd className="mt-1 font-semibold">
                          {license.scheme} / {license.licenseClass}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Hạn dùng</dt>
                        <dd className="mt-1 font-semibold">
                          {dateTime(license.expiresOn)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Chỉ số tự động</dt>
                        <dd className="mt-1 font-semibold">
                          {license.automaticOnly ? "Có" : "Không"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Trạng thái xác minh</dt>
                        <dd className="mt-1 font-semibold">
                          {license.status}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-xs text-slate-600">
                      Nhân viên đối chiếu bản gốc trước khi giao xe. Checkbox
                      xác nhận bên dưới không thay thế việc kiểm tra thực tế.
                    </p>
                  </section>
                ) : null}
                {availableActions.length ? (
                  <form
                    className="panel h-fit space-y-4"
                    onSubmit={submitAction}
                  >
                  <h2 className="text-lg font-semibold">Thao tác được phép</h2>
                  <Field label="Chuyển trạng thái">
                    <select
                      required
                      value={next}
                      onChange={(event) => setNext(event.target.value)}
                    >
                      <option value="">Chọn thao tác</option>
                      {availableActions.map((action) => (
                        <option key={action} value={action}>
                          {action}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {["REJECTED", "CANCELLED"].includes(next) ? (
                    <Field label="Lý do">
                      <textarea
                        required
                        maxLength={2000}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </Field>
                  ) : null}
                  {["IN_PROGRESS", "RETURNED"].includes(next) ? (
                    <Field label="Tình trạng xe / ghi chú">
                      <textarea
                        required
                        maxLength={2000}
                        value={condition}
                        onChange={(event) => setCondition(event.target.value)}
                      />
                    </Field>
                  ) : null}
                  {next === "IN_PROGRESS" ? (
                    <label className="flex gap-3 text-sm">
                      <input
                        type="checkbox"
                        required
                        checked={licenseChecked}
                        onChange={(event) =>
                          setLicenseChecked(event.target.checked)
                        }
                      />{" "}
                      Đã kiểm tra GPLX và xe phù hợp đến hết chuyến.
                    </label>
                  ) : null}
                  {next === "RETURNED" ? (
                    <label className="flex gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={maintenance}
                        onChange={(event) =>
                          setMaintenance(event.target.checked)
                        }
                      />{" "}
                      Xe cần bảo trì sau khi nhận.
                    </label>
                  ) : null}
                  {error ? <Notice error>{error}</Notice> : null}
                  <button className="btn" disabled={busy || !next}>
                    {busy ? "Đang lưu..." : "Cập nhật đơn"}
                  </button>
                  </form>
                ) : null}
                {currentUser?.role === "USER" &&
                ["PENDING", "CONFIRMED"].includes(booking.status) &&
                new Date(booking.startAt).getTime() - now < 86400000 ? (
                  <Notice>
                    Đã sát giờ nhận xe (dưới 24 giờ). Vui lòng liên hệ nhân viên để được hỗ trợ hủy.
                  </Notice>
                ) : null}
              </div>
              </div>
            </>
        )}
      </RequestState>
    </Page>
  );
}

export function ApiOperationPage({ kind }) {
  const { bookingId } = useParams();
  const area = "staff";
  return <ApiBookingDetailPage area={area} key={`${kind}-${bookingId}`} />;
}

export function ApiDocumentPage({ kind, area }) {
  const { bookingId } = useParams();
  const request = useApiData(
    `/bookings/${encodeURIComponent(bookingId)}/${kind}`,
  );
  const rawDocument = Array.isArray(request.data)
    ? request.data[0]
    : request.data;
  let snapshot = {};
  let documentError = "";
  if (typeof rawDocument?.snapshot === "string") {
    try {
      snapshot = JSON.parse(rawDocument.snapshot);
    } catch {
      documentError =
        "Hồ sơ được trả về nhưng không đọc được bản chụp dữ liệu.";
    }
  } else if (
    rawDocument?.snapshot &&
    typeof rawDocument.snapshot === "object"
  ) {
    snapshot = rawDocument.snapshot;
  }
  const doc = rawDocument
    ? {
        ...snapshot,
        ...rawDocument,
        items: (rawDocument.items || []).map((item) => ({
          ...item,
          unitPrice: item.unitPrice ?? item.unit_price,
        })),
      }
    : null;

  const contractLabels = {
    customer: "Khách hàng",
    vehicle: "Xe",
    pickup: "Chi nhánh nhận",
    return: "Chi nhánh trả",
    startAt: "Thời gian nhận",
    endAt: "Thời gian trả",
    rentalTotal: "Tiền thuê xe",
    oneWayFee: "Phí tuyến một chiều",
    total: "Tổng tiền",
    terms: "Điều khoản",
  };

  const invoiceLabels = {
    customer: "Khách hàng",
    vehicle: "Xe",
    pickup: "Chi nhánh nhận",
    return: "Chi nhánh trả",
    startAt: "Thời gian nhận",
    endAt: "Thời gian trả",
    note: "Ghi chú",
  };

  const formatValue = (key, value) => {
    if (value == null) return "—";
    if (typeof value === "object") return JSON.stringify(value);
    if (["startAt", "endAt"].includes(key)) return dateTime(value);
    if (["rentalTotal", "oneWayFee", "total"].includes(key))
      return money(value);
    return String(value);
  };

  const labels = kind === "contract" ? contractLabels : invoiceLabels;

  return (
    <Page
      title={kind === "contract" ? "Hợp đồng thuê xe" : "Hóa đơn thuê xe"}
      actions={
        <Link className="btn-secondary" to={`/${area}/bookings/${bookingId}`}>
          Chi tiết đơn
        </Link>
      }
    >
      <RequestState
        loading={request.loading}
        error={request.error || documentError}
        onRetry={request.reload}
      >
        {!doc ? (
          <EmptyState
            title="Hồ sơ chưa được phát hành"
            description={
              kind === "contract"
                ? "Hợp đồng chỉ được phát hành khi đơn đã xác nhận."
                : "Hóa đơn chỉ được phát hành khi đơn đã hoàn tất."
            }
          />
        ) : (
          <section className="panel mx-auto max-w-3xl">
            <div className="mb-5 flex flex-wrap justify-between gap-3 border-b pb-4">
              <strong className="text-2xl text-teal-800">KDrive</strong>
              <span className="font-semibold">{doc.id}</span>
            </div>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              {Object.entries(labels).map(([key, label]) => {
                const value = doc[key];
                if (value == null) return null;
                return (
                  <div key={key}>
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="mt-1 font-medium">{formatValue(key, value)}</dd>
                  </div>
                );
              })}
            </dl>
            {kind === "contract" && doc.terms ? (
              <div className="mt-6 border-t pt-4">
                <h3 className="font-semibold mb-2">Điều khoản</h3>
                <p className="text-sm text-slate-700 whitespace-pre-line">
                  {doc.terms}
                </p>
              </div>
            ) : null}
            {kind === "invoice" && Array.isArray(doc.items) ? (
              <div className="mt-6 space-y-3 border-t pt-4">
                {doc.items.map((item, index) => (
                  <div
                    className="flex justify-between gap-3 text-sm"
                    key={`${item.name}-${index}`}
                  >
                    <span>
                      {item.name} · {item.quantity} × {money(item.unitPrice)}
                    </span>
                    <strong>{money(item.amount)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="mt-5 text-sm text-slate-500">
              {kind === "invoice"
                ? "Hóa đơn không phải bằng chứng thanh toán."
                : "Hợp đồng là bản ghi nhận thỏa thuận; chữ ký/duyệt thực hiện theo quy trình bên ngoài."}
            </p>
          </section>
        )}
      </RequestState>
    </Page>
  );
}

export function ApiProfilePage() {
  const passwordInFlight = useRef(false);
  const profileRequest = useApiData("/auth/me");
  const licenseRequest = useApiData("/me/license");
  const navigate = useNavigate();
  const { logout, refreshUser } = useAuth();
  const [licenseScheme, setLicenseScheme] = useState("VN_2025");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const profile = profileRequest.data || {};
  const license = licenseRequest.data;
  const schemeInitialized = useRef(false);

  useEffect(() => {
    if (schemeInitialized.current || !license?.scheme) return;
    schemeInitialized.current = true;
    setLicenseScheme(license.scheme);
  }, [license?.scheme]);
  const licenseClasses =
    licenseScheme === "VN_PRE_2025"
      ? ["B1_AUTO", "B1", "B2", "C", "D", "E", "FB2", "FC", "FD", "FE"]
      : [
          "B",
          "C1",
          "C",
          "D1",
          "D2",
          "D",
          "BE",
          "C1E",
          "CE",
          "D1E",
          "D2E",
          "DE",
        ];
  async function update(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const phone = String(form.get("phone") || "").trim().replace(/[\s-]/g, "");
      if (phone && !/^\+?[0-9]{7,15}$/.test(phone)) {
        setError("Số điện thoại cần 7–15 chữ số, có thể bắt đầu bằng +.");
        return;
      }
      const updatedProfile = await updateProfile({
        fullName: String(form.get("fullName") || ""),
        phone,
        version: profile.version,
      });
      refreshUser(updatedProfile);
      setMessage("Đã cập nhật hồ sơ.");
      profileRequest.reload();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Không thể cập nhật hồ sơ."));
    } finally {
      setBusy(false);
    }
  }
  async function changePassword(event) {
    event.preventDefault();
    if (passwordInFlight.current) return;
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const passwordForm = event.currentTarget;
    const next = String(form.get("next") || "");
    const invalid = passwordError(next);
    if (invalid || next !== String(form.get("confirmation") || "")) {
      setError(invalid || "Mật khẩu nhập lại chưa khớp.");
      return;
    }
    passwordInFlight.current = true;
    setBusy(true);
    try {
      await updatePassword({
        current: String(form.get("current") || ""),
        next,
      });
      passwordForm.reset();
      await logout({ callApi: false });
      navigate("/login", { replace: true });
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Không thể đổi mật khẩu."));
    } finally {
      passwordInFlight.current = false;
      setBusy(false);
    }
  }
  async function updateLicense(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await saveLicense({
        id: license?.id || null,
        licenseNumber: String(form.get("licenseNumber") || ""),
        scheme: String(form.get("scheme") || ""),
        licenseClass: String(form.get("licenseClass") || ""),
        expiresOn: String(form.get("expiresOn") || ""),
        automaticOnly: form.get("automaticOnly") === "on",
        status: license?.status || "PENDING",
        version: license?.version || 0,
      });
      setMessage(
        "Đã lưu thông tin GPLX để nhân viên xác minh. Không tải/lưu ảnh GPLX.",
      );
      licenseRequest.reload();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Không thể lưu GPLX."));
    } finally {
      setBusy(false);
    }
  }
  const loading = profileRequest.loading || licenseRequest.loading;
  const loadError = profileRequest.error || licenseRequest.error;
  return (
    <Page
      title="Thông tin cá nhân"
      description="Quản lý hồ sơ và bằng lái phục vụ xác minh trước khi giao xe."
    >
      <RequestState
        loading={loading}
        error={loadError}
        onRetry={() => {
          profileRequest.reload();
          licenseRequest.reload();
        }}
      >
        {message ? <Notice>{message}</Notice> : null}
        {error ? <Notice error>{error}</Notice> : null}
        <div className="grid gap-5 lg:grid-cols-2">
          <form className="panel space-y-4" onSubmit={update}>
            <h2 className="text-lg font-semibold">Hồ sơ</h2>
            <Field label="Họ và tên">
              <input
                name="fullName"
                required
                maxLength={100}
                defaultValue={profile.fullName || ""}
              />
            </Field>
            <Field label="Email">
              <input readOnly value={profile.email || ""} />
            </Field>
            <Field label="Số điện thoại" hint="7–15 chữ số, có thể bắt đầu bằng +; chỉ kiểm tra định dạng, chưa xác minh sở hữu.">
              <input
                name="phone"
                type="tel"
                autoComplete="tel"
                pattern="[+0-9 -]*"
                maxLength={20}
                defaultValue={profile.phone || ""}
              />
            </Field>
            <button className="btn" disabled={busy}>
              Lưu hồ sơ
            </button>
          </form>
          <form className="panel space-y-4" onSubmit={changePassword}>
            <h2 className="text-lg font-semibold">Đổi mật khẩu</h2>
            <PasswordField label="Mật khẩu hiện tại" name="current" required maxLength={72} autoComplete="current-password" />
            <PasswordField label="Mật khẩu mới" name="next" required minLength={8} maxLength={72} autoComplete="new-password" />
            <p className="text-sm text-slate-600">{passwordHint}</p>
            <PasswordField label="Nhập lại mật khẩu mới" name="confirmation" required autoComplete="new-password" />
            <p className="text-sm text-slate-600">
              Đổi thành công sẽ đăng xuất thiết bị này và thu hồi các phiên trên thiết bị khác. Bạn cần đăng nhập lại.
            </p>
            <button className="btn-secondary" disabled={busy}>
              Đổi mật khẩu
            </button>
          </form>
          <form
            className="panel space-y-4 lg:col-span-2"
            onSubmit={updateLicense}
          >
            <h2 className="text-lg font-semibold">
              Thông tin giấy phép lái xe
            </h2>
            <p className="text-sm text-slate-600">
              Không tải ảnh GPLX. Nhân viên sẽ kiểm tra bản gốc trước khi giao
              xe.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Số giấy phép">
                <input
                  name="licenseNumber"
                  required
                  maxLength={40}
                  defaultValue={license?.licenseNumber || ""}
                />
              </Field>
              <Field label="Hạng bằng">
                <select
                  key={licenseScheme}
                  name="licenseClass"
                  required
                  defaultValue={
                    licenseClasses.includes(license?.licenseClass)
                      ? license.licenseClass
                      : licenseClasses[0]
                  }
                >
                  {licenseClasses.map((licenseClass) => (
                    <option key={licenseClass} value={licenseClass}>
                      {licenseClass}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Hệ giấy phép">
                <select
                  name="scheme"
                  required
                  value={licenseScheme}
                  onChange={(event) => setLicenseScheme(event.target.value)}
                >
                  <option value="VN_PRE_2025">Việt Nam trước 2025</option>
                  <option value="VN_2025">Việt Nam 2025</option>
                </select>
              </Field>
              <Field label="Ngày hết hạn">
                <input
                  name="expiresOn"
                  type="date"
                  required
                  defaultValue={license?.expiresOn || ""}
                />
              </Field>
            </div>
            <label className="flex gap-3 text-sm">
              <input
                name="automaticOnly"
                type="checkbox"
                defaultChecked={license?.automaticOnly || false}
              />{" "}
              Chỉ được điều khiển xe số tự động
            </label>
            {license ? (
              <p className="text-sm text-slate-600">
                Trạng thái xác minh: {license.status}
              </p>
            ) : null}
            <button className="btn" disabled={busy}>
              Lưu thông tin GPLX
            </button>
          </form>
        </div>
      </RequestState>
    </Page>
  );
}
