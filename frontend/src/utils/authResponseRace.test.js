import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { createElement, act } from "react";
import { AxiosError } from "axios";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const frontendRoot = fileURLToPath(new URL("../..", import.meta.url));
const originalDataMode = process.env.VITE_DATA_MODE;
const globalDescriptors = new Map();
const mountedRoots = new Set();
const requests = [];
let dom;
let apiClient;
let setAuthInterceptors;
let AuthProvider;
let useAuth;
let useApiData;
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

function rejectWithStatus(request, status) {
  const response = {
    config: request.config,
    data: { message: "Unauthorized" },
    headers: {},
    status,
    statusText: "Unauthorized",
  };
  request.reject(
    new AxiosError(
      `Request failed with status code ${status}`,
      "ERR_BAD_REQUEST",
      request.config,
      undefined,
      response,
    ),
  );
}

function DataProbe({ path }) {
  const state = useApiData(path);
  return createElement(
    "section",
    null,
    createElement(
      "output",
      { "data-testid": "request-state" },
      state.loading ? "loading" : state.error ? "error" : "ready",
    ),
    createElement(
      "pre",
      { "data-testid": "request-data" },
      JSON.stringify(state.data ?? null),
    ),
    createElement(
      "button",
      { type: "button", "data-testid": "reload", onClick: state.reload },
      "Reload",
    ),
  );
}

function AuthProbe({
  dataPath = null,
  onLogin = () => {},
  onLogout = () => {},
}) {
  const auth = useAuth();
  const data = useApiData(dataPath ?? "", Boolean(dataPath));
  return createElement(
    "section",
    null,
    createElement("output", { "data-testid": "token" }, auth.token ?? ""),
    createElement("output", { "data-testid": "user-id" }, auth.user?.id ?? ""),
    createElement("output", { "data-testid": "user-role" }, auth.user?.role ?? ""),
    createElement(
      "output",
      { "data-testid": "authenticated" },
      String(auth.isAuthenticated),
    ),
    createElement(
      "output",
      { "data-testid": "data-error" },
      data.error,
    ),
    createElement(
      "button",
      {
        type: "button",
        "data-testid": "login",
        onClick: () =>
          onLogin(
            auth.login({
              email: "new@example.test",
              password: "not-a-real-password",
            }),
          ),
      },
      "Login",
    ),
    createElement(
      "button",
      {
        type: "button",
        "data-testid": "logout",
        onClick: () => onLogout(auth.logout({ callApi: false })),
      },
      "Logout",
    ),
  );
}

async function mount(element, wrapInAuth = false) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.add(root);
  const app = wrapInAuth
    ? createElement(AuthProvider, null, element)
    : element;
  await act(async () => {
    root.render(app);
  });
  return {
    container,
    render: async (nextElement) => {
      const nextApp = wrapInAuth
        ? createElement(AuthProvider, null, nextElement)
        : nextElement;
      await act(async () => {
        root.render(nextApp);
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      mountedRoots.delete(root);
      container.remove();
    },
  };
}

function text(container, testId) {
  return container.querySelector(`[data-testid="${testId}"]`).textContent;
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
  ({ AuthProvider, useAuth } = await viteServer.ssrLoadModule(
    "/src/context/AuthContext.jsx",
  ));
  ({ useApiData } = await viteServer.ssrLoadModule(
    "/src/hooks/useApiData.js",
  ));
  ({ default: apiClient, setAuthInterceptors } =
    await viteServer.ssrLoadModule("/src/api/client.js"));
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
  if (viteServer) await viteServer.close();
  if (dom) dom.window.close();
  if (originalDataMode === undefined) {
    delete process.env.VITE_DATA_MODE;
  } else {
    process.env.VITE_DATA_MODE = originalDataMode;
  }
  for (const [name, descriptor] of globalDescriptors) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete globalThis[name];
    }
  }
});

test("route A resolving after route B cannot replace B's mounted hook data", async () => {
  const view = await mount(createElement(DataProbe, { path: "/route/a" }));
  const routeA = takeRequest("/route/a");

  await view.render(createElement(DataProbe, { path: "/route/b" }));
  const routeB = takeRequest("/route/b");

  await act(async () => {
    fulfill(routeB, { id: "route-b", name: "B" });
  });
  assert.equal(text(view.container, "request-state"), "ready");
  assert.deepEqual(JSON.parse(text(view.container, "request-data")), {
    id: "route-b",
    name: "B",
  });

  await act(async () => {
    fulfill(routeA, { id: "route-a", name: "A" });
  });
  assert.deepEqual(JSON.parse(text(view.container, "request-data")), {
    id: "route-b",
    name: "B",
  });
  await view.unmount();
});

test("route changes and reload hide old hook data while the replacement is pending", async () => {
  const view = await mount(createElement(DataProbe, { path: "/route/a" }));
  const firstA = takeRequest("/route/a");
  await act(async () => {
    fulfill(firstA, { id: "old-route" });
  });
  assert.equal(
    JSON.parse(text(view.container, "request-data")).id,
    "old-route",
  );

  await view.render(createElement(DataProbe, { path: "/route/b" }));
  assert.equal(text(view.container, "request-state"), "loading");
  assert.equal(text(view.container, "request-data"), "null");
  const routeB = takeRequest("/route/b");
  await act(async () => {
    fulfill(routeB, { id: "new-route" });
  });
  assert.equal(
    JSON.parse(text(view.container, "request-data")).id,
    "new-route",
  );

  await act(async () => {
    view.container.querySelector('[data-testid="reload"]').click();
  });
  assert.equal(text(view.container, "request-state"), "loading");
  assert.equal(text(view.container, "request-data"), "null");
  const reloadedB = takeRequest("/route/b");
  await act(async () => {
    fulfill(reloadedB, { id: "reloaded-route" });
  });
  assert.equal(
    JSON.parse(text(view.container, "request-data")).id,
    "reloaded-route",
  );
  await view.unmount();
});

test("late hydration cannot replace the session established by a completed login", async () => {
  localStorage.setItem("kdrive.jwt", "old-token");
  let loginPromise;
  const view = await mount(
    createElement(AuthProbe, { onLogin: (promise) => (loginPromise = promise) }),
    true,
  );
  const hydration = takeRequest("/auth/me");

  await act(async () => {
    view.container.querySelector('[data-testid="login"]').click();
  });
  const login = takeRequest("/auth/login");
  assert.equal(login.config.headers.get("Authorization"), undefined);
  await act(async () => {
    fulfill(login, {
      token: "new-token",
      user: { id: "new-user", fullName: "New", email: "new@example.test", role: "USER" },
    });
    await loginPromise;
  });

  assert.equal(text(view.container, "token"), "new-token");
  assert.equal(text(view.container, "user-id"), "new-user");
  assert.equal(text(view.container, "user-role"), "USER");
  assert.equal(localStorage.getItem("kdrive.jwt"), "new-token");

  await act(async () => {
    fulfill(hydration, {
      id: "old-user",
      fullName: "Old",
      email: "old@example.test",
      role: "USER",
    });
  });
  assert.equal(text(view.container, "token"), "new-token");
  assert.equal(text(view.container, "user-id"), "new-user");
  assert.equal(text(view.container, "user-role"), "USER");
  assert.equal(localStorage.getItem("kdrive.jwt"), "new-token");
  await view.unmount();
});

test("logout during an in-flight login prevents that response from restoring a session", async () => {
  let loginOutcome;
  const view = await mount(
    createElement(AuthProbe, {
      onLogin: (promise) => {
        loginOutcome = promise.then(
          () => ({ resolved: true }),
          (error) => ({ error }),
        );
      },
    }),
    true,
  );
  await act(async () => {
    view.container.querySelector('[data-testid="login"]').click();
  });
  const login = takeRequest("/auth/login");

  await act(async () => {
    view.container.querySelector('[data-testid="logout"]').click();
  });
  assert.equal(text(view.container, "authenticated"), "false");
  assert.equal(localStorage.getItem("kdrive.jwt"), null);

  await act(async () => {
    fulfill(login, {
      token: "late-token",
      user: { id: "late-user", fullName: "Late", email: "late@example.test", role: "USER" },
    });
    const outcome = await loginOutcome;
    assert.match(outcome.error.message, /đã bị thay thế/);
  });
  assert.equal(text(view.container, "token"), "");
  assert.equal(text(view.container, "user-id"), "");
  assert.equal(text(view.container, "user-role"), "");
  assert.equal(text(view.container, "authenticated"), "false");
  assert.equal(localStorage.getItem("kdrive.jwt"), null);
  await view.unmount();
});

test("an old-token 401 cannot clear a newer mounted session", async () => {
  localStorage.setItem("kdrive.jwt", "old-token");
  let loginPromise;
  const view = await mount(
    createElement(AuthProbe, { onLogin: (promise) => (loginPromise = promise) }),
    true,
  );
  const hydration = takeRequest("/auth/me");
  await act(async () => {
    fulfill(hydration, {
      id: "old-user",
      fullName: "Old",
      email: "old@example.test",
      role: "USER",
    });
  });
  assert.equal(text(view.container, "user-id"), "old-user");

  await view.render(createElement(AuthProbe, { dataPath: "/protected/data" }));
  const protectedRequest = takeRequest("/protected/data");
  assert.equal(
    protectedRequest.config.headers.get("Authorization"),
    "Bearer old-token",
  );

  await act(async () => {
    view.container.querySelector('[data-testid="login"]').click();
  });
  const login = takeRequest("/auth/login");
  await act(async () => {
    fulfill(login, {
      token: "new-token",
      user: { id: "new-user", fullName: "New", email: "new@example.test", role: "USER" },
    });
    await loginPromise;
  });
  assert.equal(text(view.container, "user-id"), "new-user");

  await act(async () => {
    rejectWithStatus(protectedRequest, 401);
  });
  assert.equal(text(view.container, "token"), "new-token");
  assert.equal(text(view.container, "user-id"), "new-user");
  assert.equal(text(view.container, "user-role"), "USER");
  assert.equal(text(view.container, "authenticated"), "true");
  assert.equal(localStorage.getItem("kdrive.jwt"), "new-token");
  assert.equal(
    JSON.parse(localStorage.getItem("kdrive.user")).id,
    "new-user",
  );
  await view.unmount();
});