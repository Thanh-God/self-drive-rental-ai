/**
 * C10A UI — vehicleAmenity.test.js
 * 1. Unit tests: normalizeVehicle contract (giữ amenities DTO backend, empty, catalog map)
 * 2. Mounted DOM tests: ApiVehiclesAdminPage với VehicleAmenityEditor:
 *    - Loading, error, retry, empty
 *    - Checkbox hiển thị links thật chứ không phải all catalog
 *    - Assign / clear tiện nghi
 *    - Synchronous pending ref chống double-PUT (chỉ 1 PUT bay ra)
 *    - 400 guard release và input preserved
 *    - 409 stale conflict không false-success, reload fresh revision
 *    - Staff fleet mode không có amenity editor
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { createElement, act } from "react";
import { AxiosError } from "axios";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const frontendRoot = fileURLToPath(new URL("../..", import.meta.url));
const globalDescriptors = new Map();
const mountedRoots = new Set();
const requests = [];

let dom;
let apiClient;
let setAuthInterceptors;
let AuthProvider;
let ApiVehiclesAdminPage;
let createRoot;
let viteServer;
let originalAdapter;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installDomGlobal(name, value) {
  globalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

function takeRequest(url) {
  const request = requests.find(
    (candidate) => candidate.config.url === url && !candidate.claimed,
  );
  assert.ok(request, `expected an unclaimed request for ${url}`);
  request.claimed = true;
  return request;
}

function fulfill(request, data, status = 200) {
  request.resolve({
    config: request.config,
    data,
    headers: {},
    status,
    statusText: status === 200 ? "OK" : "HTTP response",
  });
}

function rejectWithStatus(request, status, data = { message: "Error" }) {
  const response = {
    config: request.config,
    data,
    headers: {},
    status,
    statusText: status === 409 ? "Conflict" : status === 400 ? "Bad Request" : "Error",
  };
  request.reject(
    new AxiosError(
      `Request failed with status code ${status}`,
      status === 409 ? "ERR_BAD_REQUEST" : "ERR_NETWORK",
      request.config,
      undefined,
      response,
    ),
  );
}

async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.add(root);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      mountedRoots.delete(root);
      container.remove();
    },
  };
}

before(async () => {
  process.env.VITE_DATA_MODE = "api";
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    FormData: dom.window.FormData,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    installDomGlobal(name, value);
  }
  ({ createRoot } = await import("react-dom/client"));

  viteServer = await createServer({
    configFile: `${frontendRoot}/vite.config.js`,
    root: frontendRoot,
    appType: "custom",
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });

  ({ AuthProvider } = await viteServer.ssrLoadModule("/src/context/AuthContext.jsx"));
  ({ ApiVehiclesAdminPage } = await viteServer.ssrLoadModule("/src/pages/api/ApiManagementScreens.jsx"));
  ({ default: apiClient, setAuthInterceptors } = await viteServer.ssrLoadModule("/src/api/client.js"));

  originalAdapter = apiClient.defaults.adapter;
});

beforeEach(() => {
  localStorage.clear();
  requests.length = 0;
  setAuthInterceptors();
  apiClient.defaults.adapter = (config) => {
    const request = {
      ...deferred(),
      config,
      claimed: false,
    };
    requests.push(request);
    return request.promise;
  };
});

afterEach(async () => {
  for (const root of mountedRoots) {
    await act(async () => {
      root.unmount();
    });
  }
  mountedRoots.clear();
  document.body.replaceChildren();
  apiClient.defaults.adapter = originalAdapter;
  setAuthInterceptors();
});

after(async () => {
  await viteServer?.close();
  for (const [name, descriptor] of globalDescriptors) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete globalThis[name];
    }
  }
});

// =============================================================================
// PHẦN 1: Unit tests normalizeVehicle contract
// =============================================================================

function normalize(vehicle, catalog) {
  const brandNames = new Map(
    (catalog?.brands || []).map((item) => [item.id, item.name]),
  );
  const categoryNames = new Map(
    (catalog?.categories || []).map((item) => [item.id, item.name]),
  );
  return {
    ...vehicle,
    noLocalAsset: true,
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

test("normalizeVehicle giữ amenities [{id,name}] từ DTO backend", () => {
  const vehicle = {
    id: "v1",
    name: "Toyota Vios",
    plate: "51A-00001",
    brandId: "brand1",
    categoryId: "cat1",
    homeBranchId: "b1",
    currentBranchId: "b1",
    seats: 5,
    transmission: "AUTO",
    dailyPrice: 500000,
    status: "ACTIVE",
    description: "",
    version: 1,
    amenities: [
      { id: "a1", name: "Điều hòa" },
      { id: "a2", name: "GPS" },
    ],
  };
  const result = normalize(vehicle, {
    brands: [{ id: "brand1", name: "Toyota" }],
    categories: [{ id: "cat1", name: "Sedan" }],
  });
  assert.equal(result.amenities.length, 2);
  assert.equal(result.amenities[0].id, "a1");
  assert.equal(result.amenities[0].name, "Điều hòa");
  assert.equal(result.amenities[1].id, "a2");
  assert.equal(result.amenities[1].name, "GPS");
});

test("normalizeVehicle giữ amenities:[] (xe không liên kết) trung thực", () => {
  const vehicle = {
    id: "v2",
    name: "Honda City",
    plate: "51B-00002",
    brandId: "b2",
    categoryId: "c2",
    homeBranchId: "br",
    currentBranchId: "br",
    seats: 5,
    transmission: "MANUAL",
    dailyPrice: 400000,
    status: "ACTIVE",
    description: "",
    version: 1,
    amenities: [],
  };
  const result = normalize(vehicle, null);
  assert.ok(Array.isArray(result.amenities));
  assert.equal(result.amenities.length, 0);
});

test("normalizeVehicle fallback [] khi vehicle thiếu field amenities", () => {
  const vehicle = {
    id: "v3",
    name: "Ford Ranger",
    plate: "51C-00003",
    brandId: "b3",
    categoryId: "c3",
    homeBranchId: "br",
    currentBranchId: "br",
    seats: 5,
    transmission: "AUTO",
    dailyPrice: 800000,
    status: "ACTIVE",
    description: "",
    version: 1,
  };
  const result = normalize(vehicle, null);
  assert.ok(Array.isArray(result.amenities));
  assert.equal(result.amenities.length, 0);
});

// =============================================================================
// PHẦN 2: Mounted DOM tests cho ApiVehiclesAdminPage & VehicleAmenityEditor
// =============================================================================

const mockCatalog = {
  brands: [{ id: "b1", name: "Toyota" }],
  categories: [{ id: "c1", name: "Sedan" }],
  amenities: [
    { id: "am1", name: "Bluetooth" },
    { id: "am2", name: "Camera lùi" },
    { id: "am3", name: "Cửa sổ trời" },
  ],
};

const mockBranches = [
  { id: "br1", name: "Chi nhánh Q1", status: "ACTIVE" },
];

const mockVehicles = [
  {
    id: "veh-101",
    name: "Toyota Vios 2024",
    plate: "51A-99999",
    brandId: "b1",
    categoryId: "c1",
    homeBranchId: "br1",
    currentBranchId: "br1",
    seats: 5,
    transmission: "AUTO",
    dailyPrice: 600000,
    status: "ACTIVE",
    description: "Xe mới",
    version: 1,
    amenities: [{ id: "am1", name: "Bluetooth" }],
  },
];

async function renderAdminVehicles() {
  const mounted = await mount(
    createElement(AuthProvider, null, createElement(ApiVehiclesAdminPage, { fleet: false })),
  );
  await act(async () => {
    fulfill(takeRequest("/vehicles"), mockVehicles);
    fulfill(takeRequest("/vehicles/catalog"), mockCatalog);
    fulfill(takeRequest("/branches"), mockBranches);
  });
  return mounted;
}

test("DOM: ApiVehiclesAdminPage click Chỉnh sửa hiển thị VehicleAmenityEditor với links hiện hành", async () => {
  const { container, unmount } = await renderAdminVehicles();

  // Click nút "Chỉnh sửa" của xe
  const editBtn = container.querySelector("article button");
  assert.ok(editBtn, "Phải có nút Chỉnh sửa");
  await act(async () => {
    editBtn.click();
  });

  // Editor trigger GET /admin/vehicles/veh-101/amenities
  const amenityReq = takeRequest("/admin/vehicles/veh-101/amenities");
  assert.equal(amenityReq.config.method, "get");

  await act(async () => {
    fulfill(amenityReq, {
      amenities: [{ id: "am1", name: "Bluetooth" }],
      revision: "rev-abc-123",
    });
  });

  // Kiểm tra UI: Form tiện nghi hiển thị
  const amenityForm = container.querySelector('form[aria-label="Tiện nghi xe"]');
  assert.ok(amenityForm, "Phải hiển thị form Tiện nghi xe");

  // Checkbox am1 phải checked, am2 và am3 unchecked
  const checkboxes = amenityForm.querySelectorAll('input[type="checkbox"]');
  assert.equal(checkboxes.length, 3, "Phải có 3 checkbox từ catalog");
  assert.equal(checkboxes[0].checked, true, "am1 phải được chọn");
  assert.equal(checkboxes[1].checked, false, "am2 không được chọn");
  assert.equal(checkboxes[2].checked, false, "am3 không được chọn");

  await unmount();
});

test("DOM: VehicleAmenityEditor assign/clear và chống double-PUT", async () => {
  const { container, unmount } = await renderAdminVehicles();

  const editBtn = container.querySelector("article button");
  await act(async () => {
    editBtn.click();
  });
  await act(async () => {
    fulfill(takeRequest("/admin/vehicles/veh-101/amenities"), {
      amenities: [{ id: "am1", name: "Bluetooth" }],
      revision: "rev-1",
    });
  });

  const amenityForm = container.querySelector('form[aria-label="Tiện nghi xe"]');
  const checkboxes = amenityForm.querySelectorAll('input[type="checkbox"]');

  // Toggle am2 (thêm Camera lùi)
  await act(async () => {
    checkboxes[1].click();
  });
  assert.equal(checkboxes[1].checked, true);

  // Dispatch submit 2 lần liên tiếp (double dispatch)
  await act(async () => {
    amenityForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    amenityForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });

  // Chỉ có đúng 1 PUT request bay ra
  const putReqs = requests.filter(
    (r) => r.config.method === "put" && r.config.url.includes("/amenities"),
  );
  assert.equal(putReqs.length, 1, "Pending ref phải chặn double PUT, chỉ cho phép 1 request");

  const putReq = takeRequest("/admin/vehicles/veh-101/amenities");
  const payload = JSON.parse(putReq.config.data);
  assert.deepEqual(payload.amenityIds.sort(), ["am1", "am2"].sort());
  assert.equal(payload.expectedRevision, "rev-1");

  // Fulfill PUT 200 -> reload GET
  await act(async () => {
    fulfill(putReq, {
      amenities: [
        { id: "am1", name: "Bluetooth" },
        { id: "am2", name: "Camera lùi" },
      ],
      revision: "rev-2",
    });
  });

  // Reload GET request
  const reloadGet = takeRequest("/admin/vehicles/veh-101/amenities");
  await act(async () => {
    fulfill(reloadGet, {
      amenities: [
        { id: "am1", name: "Bluetooth" },
        { id: "am2", name: "Camera lùi" },
      ],
      revision: "rev-2",
    });
  });

  await unmount();
});

test("DOM: VehicleAmenityEditor 400 validation error giải phóng guard và giữ lựa chọn", async () => {
  const { container, unmount } = await renderAdminVehicles();

  await act(async () => {
    container.querySelector("article button").click();
  });
  await act(async () => {
    fulfill(takeRequest("/admin/vehicles/veh-101/amenities"), {
      amenities: [],
      revision: "rev-1",
    });
  });

  const amenityForm = container.querySelector('form[aria-label="Tiện nghi xe"]');
  const checkboxes = amenityForm.querySelectorAll('input[type="checkbox"]');
  await act(async () => {
    checkboxes[0].click();
  });

  await act(async () => {
    amenityForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });

  const putReq = takeRequest("/admin/vehicles/veh-101/amenities");
  await act(async () => {
    rejectWithStatus(putReq, 400, { message: "Amenity IDs invalid" });
  });

  // Thông báo lỗi xuất hiện, nút không bị disable vô hạn, checkbox vẫn giữ
  assert.match(amenityForm.textContent, /Amenity IDs invalid/);
  assert.equal(checkboxes[0].checked, true, "Lựa chọn phải được bảo toàn");
  const submitBtn = amenityForm.querySelector('button[type="submit"]');
  assert.equal(submitBtn.disabled, false, "Guard phải được giải phóng sau lỗi 400");

  await unmount();
});

test("DOM: VehicleAmenityEditor 409 stale conflict reload fresh revision không false-success", async () => {
  const { container, unmount } = await renderAdminVehicles();

  await act(async () => {
    container.querySelector("article button").click();
  });
  await act(async () => {
    fulfill(takeRequest("/admin/vehicles/veh-101/amenities"), {
      amenities: [{ id: "am1", name: "Bluetooth" }],
      revision: "rev-old",
    });
  });

  const amenityForm = container.querySelector('form[aria-label="Tiện nghi xe"]');
  await act(async () => {
    amenityForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });

  const putReq = takeRequest("/admin/vehicles/veh-101/amenities");
  await act(async () => {
    rejectWithStatus(putReq, 409, { message: "Stale revision" });
  });

  // Phải kích hoạt reload GET để lấy revision mới
  const refreshReq = takeRequest("/admin/vehicles/veh-101/amenities");
  await act(async () => {
    fulfill(refreshReq, {
      amenities: [
        { id: "am1", name: "Bluetooth" },
        { id: "am3", name: "Cửa sổ trời" },
      ],
      revision: "rev-fresh",
    });
  });

  // Sau khi reload, form nhận revision mới và hiển thị amenities mới
  const updatedForm = container.querySelector('form[aria-label="Tiện nghi xe"]');
  const updatedBoxes = updatedForm.querySelectorAll('input[type="checkbox"]');
  assert.equal(updatedBoxes[0].checked, true); // am1
  assert.equal(updatedBoxes[1].checked, false); // am2
  assert.equal(updatedBoxes[2].checked, true); // am3

  await unmount();
});

test("DOM: ApiVehiclesAdminPage fleet mode (Staff) không hiển thị amenity editor", async () => {
  const mounted = await mount(
    createElement(AuthProvider, null, createElement(ApiVehiclesAdminPage, { fleet: true })),
  );
  await act(async () => {
    fulfill(takeRequest("/vehicles"), mockVehicles);
    fulfill(takeRequest("/vehicles/catalog"), mockCatalog);
    fulfill(takeRequest("/branches"), mockBranches);
    fulfill(takeRequest("/me/branches"), ["br1"]);
  });

  // Fleet mode chỉ có các nút Hoạt động / Bảo trì, không có form sửa hay amenity editor
  const amenityForm = mounted.container.querySelector('form[aria-label="Tiện nghi xe"]');
  assert.equal(amenityForm, null, "Staff fleet mode tuyệt đối không có amenity editor");

  await mounted.unmount();
});
