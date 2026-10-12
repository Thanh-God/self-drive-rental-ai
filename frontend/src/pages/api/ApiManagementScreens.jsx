import { useEffect, useState, useRef, useMemo } from "react";
import apiClient from "../../api/client";
import { useApiData } from "../../hooks/useApiData";
import { getErrorMessage } from "../../utils/roles";
import { Field, money, Notice, Page } from "../../components/common/PageKit";
import EmptyState from "../../components/common/EmptyState";
import LoadingSkeleton from "../../components/common/LoadingSkeleton";
import Badge from "../../components/common/Badge";

function LoadState({ requests, retry, children }) {
  const loading = requests.some((request) => request.loading);
  const error = requests.find((request) => request.error)?.error;
  if (loading) return <LoadingSkeleton rows={3} />;
  if (error)
    return (
      <div>
        <Notice error>{error}</Notice>
        <button className="btn-secondary" onClick={retry}>
          Thử tải lại
        </button>
      </div>
    );
  return children;
}

export function ApiAccountsPage() {
  const accountsRequest = useApiData("/admin/accounts");
  const allBranchesRequest = useApiData("/branches");
  const staffBranchesRequest = useApiData("/admin/staff-branches");
  const accounts = Array.isArray(accountsRequest.data)
    ? accountsRequest.data
    : [];
  const allBranches = allBranchesRequest.data || [];
  const activeBranches = allBranches.filter(
    (branch) => branch.status === "ACTIVE",
  );
  const branchNameMap = useMemo(
    () => new Map(allBranches.map((b) => [b.id, b.name])),
    [allBranches],
  );
  const staffBranchLinks = Array.isArray(staffBranchesRequest.data)
    ? staffBranchesRequest.data
    : [];
  const assignedBranchIdsByUser = useMemo(
    () => {
      const map = new Map();
      for (const link of staffBranchLinks) {
        if (!map.has(link.userId)) map.set(link.userId, []);
        map.get(link.userId).push(link.branchId);
      }
      return map;
    },
    [staffBranchLinks],
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");

  async function addStaff(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusyId("create");
    const target = event.currentTarget;
    const form = new FormData(target);
    try {
      await apiClient.post("/admin/accounts", {
        fullName: String(form.get("fullName") || ""),
        email: String(form.get("email") || ""),
        password: String(form.get("password") || ""),
      });
      target.reset();
      setNotice("Đã tạo tài khoản Staff.");
      accountsRequest.reload();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Không thể tạo tài khoản Staff."));
    } finally {
      setBusyId("");
    }
  }

  async function changeStatus(account, status) {
    setError("");
    setNotice("");
    setBusyId(account.id);
    try {
      await apiClient.patch(
        `/admin/accounts/${encodeURIComponent(account.id)}`,
        {
          status,
          version: account.version,
        },
      );
      setNotice(`Đã cập nhật trạng thái tài khoản ${account.email}.`);
      accountsRequest.reload();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Không thể cập nhật tài khoản."));
    } finally {
      setBusyId("");
    }
  }

  async function assignBranch(event, account) {
    event.preventDefault();
    setError("");
    setNotice("");
    const target = event.currentTarget;
    const form = new FormData(target);
    setBusyId(account.id);
    try {
      await apiClient.post("/admin/staff-branches", {
        userId: account.id,
        branchId: String(form.get("branchId") || ""),
      });
      setNotice(`Đã gán chi nhánh cho ${account.fullName}.`);
      target.reset();
      accountsRequest.reload();
      staffBranchesRequest.reload();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Không thể gán chi nhánh."));
    } finally {
      setBusyId("");
    }
  }

  const reload = () => {
    accountsRequest.reload();
    allBranchesRequest.reload();
    staffBranchesRequest.reload();
  };

  const isLoading =
    accountsRequest.loading ||
    allBranchesRequest.loading ||
    staffBranchesRequest.loading;
  const loadError =
    accountsRequest.error || allBranchesRequest.error || staffBranchesRequest.error;

  return (
    <Page
      title="Quản lý tài khoản"
      description="Quản lý trạng thái User/Staff và phân công phạm vi chi nhánh."
    >
      {notice ? <Notice>{notice}</Notice> : null}
      {error ? <Notice error>{error}</Notice> : null}
      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : loadError ? (
          <div>
            <Notice error>{loadError}</Notice>
            <button className="btn-secondary" onClick={reload}>
              Thử tải lại
            </button>
          </div>
        ) : (
          <>
            {accounts.length ? (
              <div className="space-y-3">
                {accounts.map((account) => (
                  <article className="panel" key={account.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="font-semibold">{account.fullName}</h2>
                        <p className="mt-1 text-sm text-slate-500">
                          {account.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          tone={
                            account.status === "ACTIVE" ? "success" : "danger"
                          }
                        >
                          {account.status}
                        </Badge>
                        <Badge>{account.role}</Badge>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      {account.role !== "ADMIN" ? (
                        <button
                          className="btn-secondary"
                          disabled={busyId === account.id}
                          onClick={() =>
                            changeStatus(
                              account,
                              account.status === "ACTIVE"
                                ? "LOCKED"
                                : "ACTIVE",
                            )
                          }
                        >
                          {account.status === "ACTIVE"
                            ? "Khóa tài khoản"
                            : "Mở khóa"}
                        </button>
                      ) : (
                        <p className="text-xs text-slate-500">
                          Không thể khóa tài khoản quản trị.
                        </p>
                      )}
                      {account.role === "STAFF" ? (
                        <>
                          <div className="flex flex-wrap gap-2 text-sm text-slate-600">
                            {(() => {
                              const assignedIds =
                                assignedBranchIdsByUser.get(account.id) || [];
                              if (assignedIds.length === 0) {
                                return <span>Chưa phân công chi nhánh</span>;
                              }
                              return assignedIds.map((branchId) => {
                                const branchName =
                                  branchNameMap.get(branchId) || branchId;
                                const branch = allBranches.find(
                                  (b) => b.id === branchId,
                                );
                                const isInactive =
                                  branch && branch.status !== "ACTIVE";
                                return (
                                  <Badge
                                    key={branchId}
                                    tone={isInactive ? "warning" : "default"}
                                  >
                                    {branchName}{isInactive ? " (tạm ngừng)" : ""}
                                  </Badge>
                                );
                              });
                            })()}
                          </div>
                          {activeBranches.length > 0 && (
                            <form
                              className="flex flex-wrap gap-2"
                              onSubmit={(event) =>
                                assignBranch(event, account)
                              }
                            >
                              <select
                                className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm"
                                name="branchId"
                                required
                                defaultValue=""
                                disabled={busyId === account.id}
                              >
                                <option value="" disabled>
                                  Chọn chi nhánh để gán
                                </option>
                                {activeBranches.map((branch) => {
                                  const alreadyAssigned =
                                    assignedBranchIdsByUser
                                      .get(account.id)
                                      ?.includes(branch.id);
                                  return (
                                    <option
                                      key={branch.id}
                                      value={branch.id}
                                      disabled={alreadyAssigned}
                                    >
                                      {branch.name}{alreadyAssigned ? " (đã gán)" : ""}
                                    </option>
                                  );
                                })}
                              </select>
                              <button
                                type="submit"
                                className="btn-secondary"
                                disabled={busyId === account.id}
                              >
                                Gán chi nhánh
                              </button>
                            </form>
                          )}
                        </>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="Chưa có tài khoản" />
            )}
            <form className="panel h-fit space-y-4" onSubmit={addStaff}>
              <h2 className="text-lg font-semibold">Tạo nhân viên</h2>
              <Field label="Họ và tên">
                <input name="fullName" required maxLength={100} />
              </Field>
              <Field label="Email">
                <input name="email" type="email" required maxLength={254} />
              </Field>
              <Field label="Mật khẩu khởi tạo">
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  maxLength={72}
                  autoComplete="new-password"
                />
              </Field>
              <p className="text-xs text-slate-500">
                Tài khoản tạo mới có role Staff; mật khẩu không được hiển thị hoặc
                lưu ở giao diện.
              </p>
              <button type="submit" className="btn" disabled={busyId === "create"}>
                {busyId === "create" ? "Đang tạo..." : "Tạo Staff"}
              </button>
            </form>
          </>
        )}
      </div>
    </Page>
  );
}

const initialVehicleForm = {
  id: "",
  name: "",
  plate: "",
  brandId: "",
  categoryId: "",
  homeBranchId: "",
  seats: "5",
  transmission: "AUTO",
  dailyPrice: "",
  status: "ACTIVE",
  description: "",
  version: 0,
};

export function ApiVehiclesAdminPage({ fleet = false }) {
  const vehiclesRequest = useApiData("/vehicles");
  const catalogRequest = useApiData("/vehicles/catalog");
  const branchesRequest = useApiData("/branches");
  const assignmentsRequest = useApiData("/me/branches", fleet);
  const [form, setForm] = useState(initialVehicleForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const vehicles = Array.isArray(vehiclesRequest.data)
    ? vehiclesRequest.data
    : [];
  const assignedBranchIds = new Set(assignmentsRequest.data || []);
  const visibleVehicles = fleet
    ? vehicles.filter((vehicle) =>
        assignedBranchIds.has(vehicle.currentBranchId),
      )
    : vehicles;
  const catalog = catalogRequest.data || {};
  const brands = useMemo(() => catalog.brands || [], [catalog.brands]);
  const categories = useMemo(() => catalog.categories || [], [catalog.categories]);
  const branches = useMemo(
    () => (branchesRequest.data || []).filter((branch) => branch.status === "ACTIVE"),
    [branchesRequest.data],
  );
  const brandInitialized = useRef(false);
  const categoryInitialized = useRef(false);
  const branchInitialized = useRef(false);

  useEffect(() => {
    if (brandInitialized.current || form.brandId || !brands.length) return;
    brandInitialized.current = true;
    setForm((current) => ({ ...current, brandId: brands[0].id }));
  }, [brands, form.brandId]);
  useEffect(() => {
    if (categoryInitialized.current || form.categoryId || !categories.length) return;
    categoryInitialized.current = true;
    setForm((current) => ({ ...current, categoryId: categories[0].id }));
  }, [categories, form.categoryId]);
  useEffect(() => {
    if (branchInitialized.current || form.homeBranchId || !branches.length) return;
    branchInitialized.current = true;
    setForm((current) => ({ ...current, homeBranchId: branches[0].id }));
  }, [branches, form.homeBranchId]);

  function editVehicle(vehicle) {
    setForm({
      ...vehicle,
      dailyPrice: String(vehicle.dailyPrice),
      seats: String(vehicle.seats),
      homeBranchId: vehicle.homeBranchId || "",
      version: vehicle.version,
    });
    setError("");
    setNotice("");
  }

  async function saveVehicle(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const payload = {
      ...form,
      seats: Number(form.seats),
      dailyPrice: Number(form.dailyPrice),
      currentBranchId: form.currentBranchId || form.homeBranchId,
    };
    try {
      if (form.id) {
        await apiClient.put(
          `/admin/vehicles/${encodeURIComponent(form.id)}`,
          payload,
        );
        setNotice("Đã cập nhật xe.");
      } else {
        await apiClient.post("/admin/vehicles", payload);
        setNotice("Đã tạo xe.");
      }
      setForm(initialVehicleForm);
      vehiclesRequest.reload();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Không thể lưu thông tin xe."));
    } finally {
      setBusy(false);
    }
  }

  async function changeFleetStatus(vehicle, status) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await apiClient.patch(
        `/vehicles/${encodeURIComponent(vehicle.id)}/operation`,
        {
          status,
          version: vehicle.version,
        },
      );
      setNotice(`Đã cập nhật tình trạng vận hành xe ${vehicle.name}.`);
      vehiclesRequest.reload();
    } catch (requestError) {
      setError(
        getErrorMessage(requestError, "Không thể cập nhật tình trạng xe."),
      );
    } finally {
      setBusy(false);
    }
  }

  const requests = fleet
    ? [vehiclesRequest, catalogRequest, branchesRequest, assignmentsRequest]
    : [vehiclesRequest, catalogRequest, branchesRequest];
  const reload = () => requests.forEach((request) => request.reload());
  const loading = requests.some((request) => request.loading);
  const loadError = requests.find((request) => request.error)?.error;
  const sectionTitle = fleet ? "Tình trạng đội xe" : "Quản lý xe";
  return (
    <Page
      title={sectionTitle}
      description={
        fleet
          ? "Staff cập nhật tình trạng khai thác trong phạm vi quyền vận hành."
          : "Quản lý xe, giá niêm yết và chi nhánh quản lý. Giá đặt xe được máy chủ kiểm tra lại."
      }
    >
      {notice ? <Notice>{notice}</Notice> : null}
      {error ? <Notice error>{error}</Notice> : null}
      {loading ? (
        <LoadingSkeleton rows={3} />
      ) : loadError ? (
        <div>
          <Notice error>{loadError}</Notice>
          <button className="btn-secondary" onClick={reload}>
            Thử tải lại
          </button>
        </div>
      ) : (
        <div
          className={
            fleet ? "" : "grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"
          }
        >
          <div className="space-y-3">
            {visibleVehicles.map((vehicle) => (
              <article
                className="panel flex flex-wrap items-center justify-between gap-4"
                key={vehicle.id}
              >
                <div>
                  <h2 className="font-semibold">{vehicle.name}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {vehicle.plate} · {vehicle.seats} chỗ ·{" "}
                    {vehicle.transmission === "AUTO" ? "Tự động" : "Số sàn"}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {money(vehicle.dailyPrice)} / 24 giờ · Chi nhánh hiện tại:{" "}
                    {vehicle.currentBranchId}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{vehicle.status}</Badge>
                  {fleet ? (
                    <>
                      {vehicle.status === "INACTIVE" ? (
                        <span className="text-xs text-slate-500">
                          Chỉ Admin được quản lý xe ngừng khai thác.
                        </span>
                      ) : (
                        <>
                          <button
                            className="btn-secondary"
                            disabled={busy || vehicle.status === "ACTIVE"}
                            onClick={() => changeFleetStatus(vehicle, "ACTIVE")}
                          >
                            Hoạt động
                          </button>
                          <button
                            className="btn-secondary"
                            disabled={busy || vehicle.status === "MAINTENANCE"}
                            onClick={() =>
                              changeFleetStatus(vehicle, "MAINTENANCE")
                            }
                          >
                            Bảo trì
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <button
                      className="btn-secondary"
                      onClick={() => editVehicle(vehicle)}
                    >
                      Chỉnh sửa
                    </button>
                  )}
                </div>
              </article>
            ))}
            {!visibleVehicles.length ? (
              <EmptyState
                title={
                  fleet && !assignedBranchIds.size
                    ? "Chưa được gán chi nhánh"
                    : "Chưa có xe trong phạm vi"
                }
                description={
                  fleet && !assignedBranchIds.size
                    ? "Liên hệ Admin để được phân công chi nhánh vận hành."
                    : undefined
                }
              />
            ) : null}
          </div>
          {!fleet ? (
            <form className="panel h-fit space-y-4" onSubmit={saveVehicle}>
              <h2 className="text-lg font-semibold">
                {form.id ? "Cập nhật xe" : "Thêm xe"}
              </h2>
              <Field label="Tên xe">
                <input
                  required
                  maxLength={120}
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </Field>
              <Field label="Biển số">
                <input
                  required
                  maxLength={20}
                  value={form.plate}
                  onChange={(event) =>
                    setForm({ ...form, plate: event.target.value })
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Hãng xe">
                  <select
                    value={form.brandId}
                    onChange={(event) =>
                      setForm({ ...form, brandId: event.target.value })
                    }
                  >
                    {brands.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Loại xe">
                  <select
                    value={form.categoryId}
                    onChange={(event) =>
                      setForm({ ...form, categoryId: event.target.value })
                    }
                  >
                    {categories.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field
                label={`Chi nhánh quản lý${form.id ? " (giữ nguyên khi cập nhật)" : ""}`}
              >
                <select
                  required
                  disabled={Boolean(form.id)}
                  value={form.homeBranchId}
                  onChange={(event) =>
                    setForm({ ...form, homeBranchId: event.target.value })
                  }
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Số chỗ">
                  <input
                    type="number"
                    min="2"
                    max="9"
                    required
                    value={form.seats}
                    onChange={(event) =>
                      setForm({ ...form, seats: event.target.value })
                    }
                  />
                </Field>
                <Field label="Hộp số">
                  <select
                    value={form.transmission}
                    onChange={(event) =>
                      setForm({ ...form, transmission: event.target.value })
                    }
                  >
                    <option value="AUTO">Tự động</option>
                    <option value="MANUAL">Số sàn</option>
                  </select>
                </Field>
              </div>
              <Field label="Giá/ngày (VND)">
                <input
                  type="number"
                  min="1"
                  max="100000000"
                  required
                  value={form.dailyPrice}
                  onChange={(event) =>
                    setForm({ ...form, dailyPrice: event.target.value })
                  }
                />
              </Field>
              <Field label="Trạng thái">
                <select
                  value={form.status}
                  onChange={(event) =>
                    setForm({ ...form, status: event.target.value })
                  }
                >
                  <option value="ACTIVE">Đang khai thác</option>
                  <option value="MAINTENANCE">Bảo trì</option>
                  <option value="INACTIVE">Ngừng khai thác</option>
                </select>
              </Field>
              <Field label="Mô tả">
                <textarea
                  maxLength={2000}
                  value={form.description || ""}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                />
              </Field>
              <div className="flex gap-2">
                <button className="btn" disabled={busy}>
                  {busy ? "Đang lưu..." : form.id ? "Lưu thay đổi" : "Tạo xe"}
                </button>
                {form.id ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setForm(initialVehicleForm)}
                  >
                    Hủy
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}
        </div>
      )}
    </Page>
  );
}

export function ApiBranchesPage() {
  const branchesRequest = useApiData("/branches");
  const routesRequest = useApiData("/branch-routes");
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const branches = useMemo(() => branchesRequest.data || [], [branchesRequest.data]);
  const routes = useMemo(() => routesRequest.data || [], [routesRequest.data]);
  const [routeForm, setRouteForm] = useState({
    pickupBranchId: "",
    returnBranchId: "",
    fee: "",
    enabled: false,
  });

  const routeInitialized = useRef(false);

  useEffect(() => {
    if (
      routeInitialized.current ||
      routeForm.pickupBranchId ||
      !branches.length ||
      branchesRequest.loading ||
      routesRequest.loading
    )
      return;
    routeInitialized.current = true;
    const initialRoute = routes.find(
      (route) =>
        route.pickupBranchId === branches[0].id &&
        route.returnBranchId === branches[0].id,
    );
    setRouteForm((current) => ({
      ...current,
      pickupBranchId: branches[0].id,
      returnBranchId: branches[0].id,
      fee: initialRoute ? String(initialRoute.fee) : "",
      enabled: initialRoute?.enabled ?? false,
    }));
  }, [
    branches,
    routes,
    routeForm.pickupBranchId,
    branchesRequest.loading,
    routesRequest.loading,
  ]);

  async function saveBranch(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const input = {
      name: String(form.get("name") || ""),
      address: String(form.get("address") || ""),
      version: selected?.version || 0,
    };
    try {
      if (selected) {
        await apiClient.put(
          `/admin/branches/${encodeURIComponent(selected.id)}`,
          input,
        );
        setNotice("Đã cập nhật chi nhánh.");
      } else {
        await apiClient.post("/admin/branches", input);
        setNotice("Đã tạo chi nhánh.");
      }
      setSelected(null);
      branchesRequest.reload();
      routesRequest.reload();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Không thể lưu chi nhánh."));
    } finally {
      setBusy(false);
    }
  }

  async function saveRoute(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const existingRoute = routes.find(
      (route) =>
        route.pickupBranchId === routeForm.pickupBranchId &&
        route.returnBranchId === routeForm.returnBranchId,
    );
    try {
      await apiClient.put("/admin/branch-routes", {
        pickupBranchId: routeForm.pickupBranchId,
        returnBranchId: routeForm.returnBranchId,
        fee: Number(routeForm.fee),
        enabled: routeForm.enabled,
        expectedVersion: existingRoute ? Number(existingRoute.version) : 0,
      });
      setNotice("Đã cập nhật tuyến nhận/trả.");
      routesRequest.reload();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Không thể lưu tuyến."));
      if (requestError.response?.status === 409) routesRequest.reload();
    } finally {
      setBusy(false);
    }
  }

  function changeRoute(key, value) {
    const next = { ...routeForm, [key]: value };
    const savedRoute = routes.find(
      (route) =>
        route.pickupBranchId === next.pickupBranchId &&
        route.returnBranchId === next.returnBranchId,
    );
    setRouteForm({
      ...next,
      fee: savedRoute ? String(savedRoute.fee) : "",
      enabled: savedRoute?.enabled ?? false,
    });
  }

  const loading = branchesRequest.loading || routesRequest.loading;
  const loadError = branchesRequest.error || routesRequest.error;
  return (
    <Page
      title="Chi nhánh & tuyến nhận/trả"
      description="Quản lý điểm giao nhận và phí tuyến. Không nhầm chi nhánh với địa điểm du lịch."
    >
      {notice ? <Notice>{notice}</Notice> : null}
      {error ? <Notice error>{error}</Notice> : null}
      {loading ? (
        <LoadingSkeleton rows={3} />
      ) : loadError ? (
        <div>
          <Notice error>{loadError}</Notice>
          <button
            className="btn-secondary"
            onClick={() => {
              branchesRequest.reload();
              routesRequest.reload();
            }}
          >
            Thử tải lại
          </button>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-3">
              {branches.map((branch) => (
                <article
                  className="panel flex flex-wrap items-center justify-between gap-3"
                  key={branch.id}
                >
                  <div>
                    <h2 className="font-semibold">{branch.name}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {branch.address}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {branch.status}
                    </p>
                  </div>
                  <button
                    className="btn-secondary"
                    onClick={() => setSelected(branch)}
                  >
                    Chỉnh sửa
                  </button>
                </article>
              ))}
            </div>
            <form className="panel space-y-4" onSubmit={saveBranch}>
              <h2 className="text-lg font-semibold">
                {selected ? "Sửa chi nhánh" : "Thêm chi nhánh"}
              </h2>
              <Field label="Tên chi nhánh">
                <input
                  key={`${selected?.id || "new"}-name`}
                  name="name"
                  required
                  maxLength={120}
                  defaultValue={selected?.name || ""}
                />
              </Field>
              <Field label="Địa chỉ">
                <input
                  key={`${selected?.id || "new"}-address`}
                  name="address"
                  required
                  maxLength={300}
                  defaultValue={selected?.address || ""}
                />
              </Field>
              <div className="flex gap-2">
                <button className="btn" disabled={busy}>
                  {busy
                    ? "Đang lưu..."
                    : selected
                      ? "Lưu thay đổi"
                      : "Tạo chi nhánh"}
                </button>
                {selected ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setSelected(null)}
                  >
                    Hủy
                  </button>
                ) : null}
              </div>
            </form>
          </div>
          <div className="space-y-4">
            <section className="panel">
              <h2 className="mb-4 text-lg font-semibold">
                Các tuyến đã cấu hình
              </h2>
              {routes.length ? (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Nhận → trả</th>
                        <th>Phí</th>
                        <th>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {routes.map((route) => (
                        <tr key={route.id}>
                          <td>
                            {branches.find(
                              (branch) => branch.id === route.pickupBranchId,
                            )?.name || route.pickupBranchId}{" "}
                            →{" "}
                            {branches.find(
                              (branch) => branch.id === route.returnBranchId,
                            )?.name || route.returnBranchId}
                          </td>
                          <td>{money(route.fee)}</td>
                          <td>{route.enabled ? "Đang mở" : "Đã đóng"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Chưa có tuyến.</p>
              )}
            </section>
            <form className="panel space-y-4" onSubmit={saveRoute}>
              <h2 className="text-lg font-semibold">Cấu hình tuyến</h2>
              <Field label="Chi nhánh nhận">
                <select
                  required
                  value={routeForm.pickupBranchId}
                  onChange={(event) =>
                    changeRoute("pickupBranchId", event.target.value)
                  }
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Chi nhánh trả">
                <select
                  required
                  value={routeForm.returnBranchId}
                  onChange={(event) =>
                    changeRoute("returnBranchId", event.target.value)
                  }
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Phí tuyến (VND)">
                <input
                  type="number"
                  required
                  min="0"
                  max="100000000"
                  value={routeForm.fee}
                  onChange={(event) =>
                    setRouteForm({ ...routeForm, fee: event.target.value })
                  }
                />
              </Field>
              <label className="flex gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={routeForm.enabled}
                  onChange={(event) =>
                    setRouteForm({
                      ...routeForm,
                      enabled: event.target.checked,
                    })
                  }
                />{" "}
                Tuyến đang hoạt động
              </label>
              <button className="btn" disabled={busy || branches.length < 1}>
                Lưu tuyến
              </button>
            </form>
          </div>
        </div>
      )}
    </Page>
  );
}

export function ApiReviewsAdminPage() {
  const reviewsRequest = useApiData("/admin/reviews");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const reviews = Array.isArray(reviewsRequest.data) ? reviewsRequest.data : [];
  async function moderate(review) {
    if (busyId) return;
    setError("");
    setNotice("");
    setBusyId(review.id);
    try {
      await apiClient.patch(`/admin/reviews/${encodeURIComponent(review.id)}`, {
        hidden: !review.hidden,
        version: review.version,
      });
      setNotice(review.hidden ? "Đã hiển thị đánh giá." : "Đã ẩn đánh giá.");
      reviewsRequest.reload();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Không thể kiểm duyệt đánh giá."));
      if (requestError.response?.status === 409) {
        reviewsRequest.reload();
      }
    } finally {
      setBusyId("");
    }
  }
  return (
    <Page
      title="Kiểm duyệt đánh giá"
      description="Ẩn hoặc hiển thị đánh giá; thay đổi được ghi nhận phía máy chủ."
    >
      {notice ? <Notice>{notice}</Notice> : null}
      {error ? <Notice error>{error}</Notice> : null}
      {reviewsRequest.loading ? (
        <LoadingSkeleton rows={3} />
      ) : reviewsRequest.error ? (
        <div>
          <Notice error>{reviewsRequest.error}</Notice>
          <button className="btn-secondary" onClick={reviewsRequest.reload}>
            Thử tải lại
          </button>
        </div>
      ) : reviews.length ? (
        <div className="space-y-3">
          {reviews.map((review) => (
            <article className="panel" key={review.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {review.rating}/5 sao · Đơn{" "}
                    {review.booking_id || review.bookingId}
                  </p>
                  <p className="mt-2 leading-6 text-slate-700">
                    {review.content}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    {review.hidden ? "Đang ẩn" : "Đang công khai"}
                  </p>
                </div>
                <button
                  className="btn-secondary"
                  disabled={busyId === review.id}
                  onClick={() => moderate(review)}
                >
                  {review.hidden ? "Hiển thị" : "Ẩn đánh giá"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Chưa có đánh giá"
          description="Đánh giá mới từ đơn đã hoàn tất sẽ xuất hiện tại đây."
        />
      )}
    </Page>
  );
}
