import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { act, createElement } from "react";
import { AxiosError } from "axios";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const frontendRoot = fileURLToPath(new URL("../../..", import.meta.url));
const globals = new Map();
const roots = new Set();
const requests = [];
let dom;
let viteServer;
let apiClient;
let ApiVehiclesAdminPage;
let createRoot;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function take(url, method = "get") {
  const request = requests.find((item) => !item.claimed && item.config.url === url &&
    (item.config.method || "get").toLowerCase() === method);
  assert.ok(request, `expected ${method.toUpperCase()} ${url}; seen: ${requests.map((item) => `${item.config.method} ${item.config.url}`).join(", ")}; dom: ${document.body.textContent}`);
  request.claimed = true;
  return request;
}

function resolve(request, data, status = 200) {
  request.resolve({ config: request.config, data, headers: {}, status, statusText: "OK" });
}

function reject(request, status, data = { message: "Máy chủ từ chối yêu cầu." }) {
  request.reject(new AxiosError(
    `Request failed with status code ${status}`,
    "ERR_BAD_REQUEST",
    request.config,
    undefined,
    { config: request.config, data, headers: {}, status, statusText: "Conflict" },
  ));
}

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  await act(async () => root.render(createElement(ApiVehiclesAdminPage)));
  return container;
}

function resetRequests() {
  requests.length = 0;
  apiClient.defaults.adapter = (config) => {
    const request = { ...deferred(), config, claimed: false };
    requests.push(request);
    return request.promise;
  };
}

async function unmountAll() {
  for (const root of roots) await act(async () => root.unmount());
  roots.clear();
  document.body.replaceChildren();
}

before(async () => {
  process.env.VITE_DATA_MODE = "api";
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
    Node: dom.window.Node,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
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
  ({ ApiVehiclesAdminPage } = await viteServer.ssrLoadModule("/src/pages/api/ApiManagementScreens.jsx"));
  ({ default: apiClient } = await viteServer.ssrLoadModule("/src/api/client.js"));
});

const vehicle = { id: "new", name: "Xe mới", plate: "TEST-01", seats: 5, transmission: "AUTO", currentBranchId: "long-branch-id", homeBranchId: "long-branch-id", dailyPrice: 500000, status: "ACTIVE", version: 4 };
async function loaded() {
  resetRequests();
  const container = await mount();
  await act(async () => {
    resolve(take("/vehicles"), [vehicle]);
    resolve(take("/vehicles/catalog"), { brands: [{ id: "brand", name: "Hãng thử" }], categories: [{ id: "category", name: "Loại thử" }] });
    resolve(take("/branches"), [{ id: "long-branch-id", name: "Chi nhánh thử nghiệm", status: "ACTIVE" }]);
  });
  return container;
}
function button(container, name) { return [...container.querySelectorAll("button")].find((item) => item.textContent.trim() === name); }

test("vehicle delete cancel sends no request; actions share a separate bottom row", async () => {
  const container = await loaded();
  let confirmation;
  window.confirm = (message) => { confirmation = message; return false; };
  const article = container.querySelector("article");
  const actions = article.lastElementChild;
  assert.equal(button(container, "Xóa xe").parentElement, actions);
  assert.equal(button(container, "Chỉnh sửa").parentElement, actions);
  assert.match(article.textContent, /Chi nhánh thử nghiệm/);
  await act(async () => button(container, "Xóa xe").click());
  assert.match(confirmation, /Xe mới \(TEST-01\)/);
  assert.equal(requests.filter((item) => item.config.method === "delete").length, 0);
  await unmountAll();
});

test("confirmed delete uses current version, blocks controls while pending and reloads after success", async () => {
  const container = await loaded();
  window.confirm = () => true;
  await act(async () => { button(container, "Xóa xe").click(); button(container, "Xóa xe").click(); });
  assert.equal(requests.filter((item) => item.config.method === "delete").length, 1);
  const request = take("/admin/vehicles/new", "delete");
  assert.deepEqual(request.config.params, { version: 4 });
  assert.equal(button(container, "Xóa xe").disabled, true);
  assert.equal(button(container, "Chỉnh sửa").disabled, true);
  assert.doesNotMatch(container.textContent, /Đã xóa xe/);
  await act(async () => resolve(request, null, 204));
  const reload = take("/vehicles");
  await act(async () => resolve(reload, []));
  assert.match(container.textContent, /Đã xóa xe Xe mới/);
  assert.equal(container.querySelectorAll("article").length, 0);
  await unmountAll();
});

test("history or stale conflict keeps vehicle and displays server message without success", async () => {
  const container = await loaded();
  window.confirm = () => true;
  await act(async () => button(container, "Xóa xe").click());
  await act(async () => reject(take("/admin/vehicles/new", "delete"), 409, { message: "Xe đã có đơn thuê. Hãy dùng Ngừng khai thác." }));
  assert.match(container.querySelector('[role="alert"]').textContent, /Ngừng khai thác/);
  assert.equal(container.querySelectorAll("article").length, 1);
  assert.doesNotMatch(container.textContent, /Đã xóa xe/);
  assert.equal(button(container, "Xóa xe").disabled, false);
  await unmountAll();
});

after(async () => {
  await viteServer?.close();
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  dom?.window.close();
});
