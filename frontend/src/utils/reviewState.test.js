import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { createElement, act } from "react";
import { AxiosError } from "axios";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { selectApiRequestState } from "./apiRequestState.js";

const frontendRoot = fileURLToPath(new URL("../..", import.meta.url));
const globalDescriptors = new Map();
const mountedRoots = new Set();
const requests = [];

let dom;
let apiClient;
let setAuthInterceptors;
let AuthProvider;
let ApiBookingDetailPage;
let BookingReviewSection;
let ApiReviewsAdminPage;
let MemoryRouter;
let Routes;
let Route;
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
    statusText: status === 409 ? "Conflict" : "Error",
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

function changeValue(element, value) {
  const prototype = element instanceof dom.window.HTMLTextAreaElement
    ? dom.window.HTMLTextAreaElement.prototype
    : element instanceof dom.window.HTMLSelectElement
      ? dom.window.HTMLSelectElement.prototype
      : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
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
  ({ ApiBookingDetailPage, BookingReviewSection } = await viteServer.ssrLoadModule("/src/pages/api/ApiScreens.jsx"));
  ({ ApiReviewsAdminPage } = await viteServer.ssrLoadModule("/src/pages/api/ApiManagementScreens.jsx"));
  ({ default: apiClient, setAuthInterceptors } = await viteServer.ssrLoadModule("/src/api/client.js"));
  ({ MemoryRouter, Routes, Route } = await viteServer.ssrLoadModule("react-router-dom"));

  originalAdapter = apiClient.defaults.adapter;
});

beforeEach(() => {
  localStorage.clear();
  requests.length = 0;
  setAuthInterceptors();
  apiClient.defaults.adapter = (config) => {
    // Tự động fulfill các request phụ trợ không thuộc phạm vi review (như /incidents) để tránh timeout
    if (config.url?.startsWith("/incidents")) {
      return Promise.resolve({
        config,
        data: [],
        headers: {},
        status: 200,
        statusText: "OK",
      });
    }
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
// Unit test helper (Tiêu chí 1 baseline - giữ lại selectApiRequestState theo audit)
// =============================================================================
test("review request state distinctions: loading, error, success-null, and success-review", () => {
  const requestKey = { path: "/bookings/b1/review" };

  const loadingState = selectApiRequestState(null, requestKey, true);
  assert.equal(loadingState.loading, true);
  assert.equal(loadingState.error, "");
  assert.equal(loadingState.data, null);

  const errorResult = {
    requestKey,
    data: null,
    error: "Lỗi mạng hoặc máy chủ không phản hồi.",
  };
  const errorState = selectApiRequestState(errorResult, requestKey, true);
  assert.equal(errorState.loading, false);
  assert.equal(errorState.error, "Lỗi mạng hoặc máy chủ không phản hồi.");
  assert.equal(errorState.data, null);

  const successNullResult = {
    requestKey,
    data: null,
    error: "",
  };
  const unreviewedState = selectApiRequestState(successNullResult, requestKey, true);
  assert.equal(unreviewedState.loading, false);
  assert.equal(unreviewedState.error, "");
  assert.equal(unreviewedState.data, null);

  const reviewData = {
    id: "r-123",
    booking_id: "b1",
    rating: 5,
    content: "Xe rất tốt và sạch sẽ.",
    hidden: false,
    version: 0,
  };
  const successReviewResult = {
    requestKey,
    data: reviewData,
    error: "",
  };
  const reviewedState = selectApiRequestState(successReviewResult, requestKey, true);
  assert.equal(reviewedState.loading, false);
  assert.equal(reviewedState.error, "");
  assert.deepEqual(reviewedState.data, reviewData);
});

// =============================================================================
// Tiêu chí 1: Mount actual React component BookingReviewSection vào DOM:
// Kiểm tra loading (skeleton), error (notice + nút retry), success-empty (form),
// success-review (nội dung đánh giá), và hidden khi không đúng điều kiện
// =============================================================================
test("DOM: BookingReviewSection handles loading, error with retry, success-empty, and success-review states", async () => {
  const completedBooking = { id: "b-1", status: "COMPLETED" };

  // 1. Loading state: chỉ hiển thị skeleton, không hiện form hay review
  let reloaded = false;
  const loadingReq = {
    loading: true,
    error: "",
    data: null,
    reload: () => { reloaded = true; },
  };
  const { container: loadingContainer, unmount: unmountLoading } = await mount(
    createElement(BookingReviewSection, {
      booking: completedBooking,
      area: "user",
      bookingReviewRequest: loadingReq,
      submitReview: () => {},
      rating: "5",
      setRating: () => {},
      review: "",
      setReview: () => {},
      reviewBusy: false,
    }),
  );
  assert.ok(loadingContainer.querySelector(".animate-pulse"), "Skeleton must be rendered during loading");
  assert.equal(loadingContainer.querySelector("form"), null, "Form must NOT be rendered during loading");
  assert.equal(loadingContainer.querySelector("button[type='submit']"), null);
  await unmountLoading();

  // 2. Error state: hiển thị thông báo lỗi và nút retry; retry thực gọi lại reload(); không hiển thị form
  const errorReq = {
    loading: false,
    error: "Lỗi mạng từ máy chủ.",
    data: null,
    reload: () => { reloaded = true; },
  };
  const { container: errorContainer, unmount: unmountError } = await mount(
    createElement(BookingReviewSection, {
      booking: completedBooking,
      area: "user",
      bookingReviewRequest: errorReq,
      submitReview: () => {},
      rating: "5",
      setRating: () => {},
      review: "",
      setReview: () => {},
      reviewBusy: false,
    }),
  );
  assert.ok(errorContainer.textContent.includes("Lỗi mạng từ máy chủ."), "Error notice must be visible");
  const retryBtn = errorContainer.querySelector("button.btn-secondary");
  assert.ok(retryBtn, "Retry button must be rendered on error");
  assert.equal(retryBtn.textContent.trim(), "Thử tải lại đánh giá");
  assert.equal(errorContainer.querySelector("form"), null, "Form must NOT be rendered on error");

  await act(async () => {
    retryBtn.click();
  });
  assert.equal(reloaded, true, "Clicking retry must call bookingReviewRequest.reload()");
  await unmountError();

  // 3. Success-empty state (chưa có đánh giá): hiển thị form gửi đánh giá
  const emptyReq = {
    loading: false,
    error: "",
    data: null,
    reload: () => {},
  };
  const { container: emptyContainer, unmount: unmountEmpty } = await mount(
    createElement(BookingReviewSection, {
      booking: completedBooking,
      area: "user",
      bookingReviewRequest: emptyReq,
      submitReview: () => {},
      rating: "5",
      setRating: () => {},
      review: "",
      setReview: () => {},
      reviewBusy: false,
    }),
  );
  assert.ok(emptyContainer.querySelector("form"), "Form must be rendered when booking has no review");
  assert.ok(emptyContainer.querySelector("select"), "Rating select must be rendered");
  assert.ok(emptyContainer.querySelector("textarea"), "Review content textarea must be rendered");
  const submitBtn = emptyContainer.querySelector("button.btn");
  assert.ok(submitBtn);
  assert.equal(submitBtn.textContent.trim(), "Gửi đánh giá");
  assert.equal(submitBtn.disabled, false);
  await unmountEmpty();

  // 4. Success-review state: hiển thị đánh giá của khách hàng, không hiển thị form
  const reviewedReq = {
    loading: false,
    error: "",
    data: {
      id: "rev-100",
      rating: 5,
      content: "Xe sạch sẽ và giao đúng giờ.",
      created_at: "2026-10-04T12:00:00Z",
      hidden: false,
    },
    reload: () => {},
  };
  const { container: reviewContainer, unmount: unmountReview } = await mount(
    createElement(BookingReviewSection, {
      booking: completedBooking,
      area: "user",
      bookingReviewRequest: reviewedReq,
      submitReview: () => {},
      rating: "5",
      setRating: () => {},
      review: "",
      setReview: () => {},
      reviewBusy: false,
    }),
  );
  assert.equal(reviewContainer.querySelector("form"), null, "Form must NOT be rendered when review exists");
  assert.ok(reviewContainer.textContent.includes("Đánh giá của bạn"));
  assert.ok(reviewContainer.textContent.includes("5/5 sao"));
  assert.ok(reviewContainer.textContent.includes("Xe sạch sẽ và giao đúng giờ."));
  await unmountReview();

  // 5. Điều kiện ẩn: area !== "user" hoặc booking status !== "COMPLETED"
  const pendingBooking = { id: "b-2", status: "CONFIRMED" };
  const { container: pendingContainer, unmount: unmountPending } = await mount(
    createElement(BookingReviewSection, {
      booking: pendingBooking,
      area: "user",
      bookingReviewRequest: emptyReq,
      submitReview: () => {},
      rating: "5",
      setRating: () => {},
      review: "",
      setReview: () => {},
      reviewBusy: false,
    }),
  );
  assert.equal(pendingContainer.innerHTML, "", "Must render null when booking is not COMPLETED");
  await unmountPending();
});

// =============================================================================
// Tiêu chí 2: Held promise submission: button disabled, chỉ 1 POST trước resolve,
// sau resolve/error trả busy về đúng trạng thái (kiểm tra wiring trên ApiBookingDetailPage)
// =============================================================================
test("DOM: submitReview held promise prevents double-submit, disables button, and restores busy state", async () => {
  const { container, unmount } = await mount(
    createElement(
      AuthProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: ["/user/bookings/b-test-held"] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: "/:area/bookings/:bookingId",
            element: createElement(ApiBookingDetailPage, { area: "user" }),
          }),
        ),
      ),
    ),
  );

  // Fulfill booking detail
  const bReq = takeRequest("/bookings/b-test-held");
  await act(async () => {
    fulfill(bReq, {
      booking: {
        id: "b-test-held",
        status: "COMPLETED",
        vehicleName: "VinFast VF8 Eco",
        version: 0,
      },
      license: null,
      records: [],
    });
  });

  // Fulfill review request with null (unreviewed)
  const rReq = takeRequest("/bookings/b-test-held/review");
  await act(async () => {
    fulfill(rReq, null);
  });

  // Tìm form đánh giá cụ thể trong trang (phân biệt với form lập sự cố)
  const findReviewForm = () =>
    Array.from(container.querySelectorAll("form")).find(
      (f) => Boolean(f.querySelector("select")) && f.textContent.includes("Gửi đánh giá"),
    );

  const reviewForm = findReviewForm();
  assert.equal(Boolean(reviewForm), true, "Review form must be rendered for completed booking");
  const textarea = reviewForm.querySelector("textarea");
  const submitBtn = reviewForm.querySelector("button.btn");

  // 1. Kiểm tra held promise khi submit bị ERROR: button disabled trong lúc gửi,
  // sau khi error reject thì busy được reset, button enabled trở lại và thông báo lỗi hiển thị
  await act(async () => {
    changeValue(textarea, "Nội dung thử lỗi");
  });

  await act(async () => {
    const event = new dom.window.Event("submit", { bubbles: true, cancelable: true });
    reviewForm.dispatchEvent(event);
  });

  const errorPostReq = takeRequest("/reviews");
  assert.equal(errorPostReq.config.method, "post");
  assert.equal(submitBtn.disabled, true, "Submit button must be disabled while submission is held");
  assert.equal(submitBtn.textContent.trim(), "Đang gửi...");

  // Reject submission
  await act(async () => {
    rejectWithStatus(errorPostReq, 400, { message: "Đánh giá không hợp lệ." });
  });

  assert.equal(submitBtn.disabled, false, "Submit button busy must be reset to enabled after error");
  assert.equal(submitBtn.textContent.trim(), "Gửi đánh giá");
  assert.equal(container.textContent.includes("Đánh giá không hợp lệ."), true, "Error message must be displayed");

  // 2. Kiểm tra held promise khi submit SUCCESS & CHẶN DOUBLE SUBMIT:
  await act(async () => {
    changeValue(textarea, "Đánh giá kiểm thử concurrency");
  });

  let submitEventDefaultPrevented = false;
  await act(async () => {
    const event = new dom.window.Event("submit", { bubbles: true, cancelable: true });
    reviewForm.dispatchEvent(event);
    submitEventDefaultPrevented = event.defaultPrevented;
  });
  assert.equal(submitEventDefaultPrevented, true, "Form submission must preventDefault");

  const successPostReq = takeRequest("/reviews");
  assert.equal(successPostReq.config.method, "post");
  assert.equal(successPostReq.config.data, JSON.stringify({
    bookingId: "b-test-held",
    rating: 5,
    content: "Đánh giá kiểm thử concurrency",
  }));

  // Khi promise đang pending: button disabled
  assert.equal(submitBtn.disabled, true, "Submit button must be disabled during submission");
  assert.equal(submitBtn.textContent.trim(), "Đang gửi...", "Submit button text must indicate busy");

  // Thử submit lần 2 trong lúc pending -> bị chặn bởi reviewBusy guard, không gửi thêm request
  await act(async () => {
    const event2 = new dom.window.Event("submit", { bubbles: true, cancelable: true });
    reviewForm.dispatchEvent(event2);
  });
  const concurrentRequests = requests.filter((r) => r.config.url === "/reviews" && !r.claimed);
  assert.equal(concurrentRequests.length, 0, "Double-submit while pending must be blocked; no concurrent request sent");

  // Fulfill held submission
  await act(async () => {
    fulfill(successPostReq, { id: "rev-held-1", rating: 5, content: "Đánh giá kiểm thử concurrency" });
  });

  // Sau khi hoàn tất: reload được gọi và thông báo thành công hiển thị
  assert.equal(container.textContent.includes("Đã gửi đánh giá cho đơn hoàn tất."), true);
  const reloadReq = takeRequest("/bookings/b-test-held/review");
  assert.equal(Boolean(reloadReq), true, "Review reload must be triggered after successful submission");

  // Fulfill reload với dữ liệu đánh giá mới
  await act(async () => {
    fulfill(reloadReq, { id: "rev-held-1", rating: 5, content: "Đánh giá kiểm thử concurrency" });
  });

  // Form review đã được thay thế bằng khối hiển thị đánh giá
  assert.equal(Boolean(findReviewForm()), false, "Review form must be replaced by review display after reload");
  assert.equal(container.textContent.includes("Đánh giá kiểm thử concurrency"), true);

  await unmount();
});

// =============================================================================
// Tiêu chí 3: Moderation stale 409: handler hiện lỗi + reload version mới,
// ca 200 riêng trên ApiReviewsAdminPage
// =============================================================================
test("DOM: ApiReviewsAdminPage moderation handles stale 409 conflict with reload and separates 200 success", async () => {
  const { container, unmount } = await mount(
    createElement(
      AuthProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: ["/admin/reviews"] },
        createElement(ApiReviewsAdminPage, null),
      ),
    ),
  );

  // 1. Initial admin reviews load
  const adminReq1 = takeRequest("/admin/reviews");
  const initialReviews = [
    {
      id: "rev-mod-1",
      bookingId: "b-101",
      rating: 4,
      content: "Nội dung ban đầu của đánh giá",
      hidden: false,
      version: 0,
    },
  ];
  await act(async () => {
    fulfill(adminReq1, initialReviews);
  });

  // Check DOM: Review rendered with 'Ẩn đánh giá' button
  assert.ok(container.textContent.includes("Nội dung ban đầu của đánh giá"));
  assert.ok(container.textContent.includes("Đang công khai"));
  let hideBtn = container.querySelector("button.btn-secondary");
  assert.ok(hideBtn);
  assert.equal(hideBtn.textContent.trim(), "Ẩn đánh giá");

  // 2. Click hide -> sends PATCH /admin/reviews/rev-mod-1
  await act(async () => {
    hideBtn.click();
  });

  const patchReq1 = takeRequest("/admin/reviews/rev-mod-1");
  assert.equal(patchReq1.config.method, "patch");
  assert.deepEqual(JSON.parse(patchReq1.config.data), {
    hidden: true,
    version: 0,
  });

  // Khi đang pending: nút bị disable
  assert.equal(hideBtn.disabled, true, "Moderation button must be disabled while request is busy");

  // 3. Server responds with 409 Conflict (e.g. concurrent moderation)
  await act(async () => {
    rejectWithStatus(patchReq1, 409, {
      message: "Đánh giá đã được chỉnh sửa bởi phiên quản trị khác.",
    });
  });

  // Assert DOM: Error notice displayed, NO success notice
  assert.ok(
    container.textContent.includes("Không thể kiểm duyệt đánh giá.") ||
    container.textContent.includes("Đánh giá đã được chỉnh sửa"),
    "Error notice must be displayed on 409 conflict",
  );
  assert.ok(!container.textContent.includes("Đã ẩn đánh giá."), "Success notice must NOT be displayed on 409");

  // Handler must trigger reload to fetch current version
  const reloadReq = takeRequest("/admin/reviews");
  assert.ok(reloadReq, "409 Conflict must trigger reviewsRequest.reload()");

  // Fulfill reload with updated version from server
  const updatedReviews = [
    {
      id: "rev-mod-1",
      bookingId: "b-101",
      rating: 4,
      content: "Nội dung ban đầu của đánh giá",
      hidden: true,
      version: 1,
    },
  ];
  await act(async () => {
    fulfill(reloadReq, updatedReviews);
  });

  // Re-query button from container after re-render:
  hideBtn = container.querySelector("button.btn-secondary");
  assert.ok(hideBtn);
  assert.ok(container.textContent.includes("Nội dung ban đầu của đánh giá"), "Review content must be preserved");
  assert.ok(container.textContent.includes("Đang ẩn"), "Updated hidden status must be rendered");
  assert.equal(hideBtn.textContent.trim(), "Hiển thị", "Button label must reflect updated state");
  assert.equal(hideBtn.disabled, false, "Button busy state must be restored to false");

  // 4. Test normal 200 case: Click 'Hiển thị'
  await act(async () => {
    hideBtn.click();
  });

  const patchReq2 = takeRequest("/admin/reviews/rev-mod-1");
  assert.equal(patchReq2.config.method, "patch");
  assert.deepEqual(JSON.parse(patchReq2.config.data), {
    hidden: false,
    version: 1,
  });

  // Resolve with 200 OK
  await act(async () => {
    fulfill(patchReq2, { ...updatedReviews[0], hidden: false, version: 2 });
  });

  // Assert DOM: Success notice shown
  assert.ok(container.textContent.includes("Đã hiển thị đánh giá."));

  await unmount();
});

// =============================================================================
// Tiêu chí 4: XSS Safety DOM test: render payload độc hại (<script>, <img onerror>)
// vào actual review display, kiểm tra literal textContent, không sinh tag/script
// và sentinel không bị execute
// =============================================================================
test("DOM: XSS safety: malicious payload in review content is rendered as literal text without DOM script execution", async () => {
  dom.window.__xssScriptExecuted = false;
  dom.window.__xssImageExecuted = false;

  const maliciousPayload = '<script>window.__xssScriptExecuted=true;</script><img src="invalid-src-xss" onerror="window.__xssImageExecuted=true;">';

  // 1. Test in BookingReviewSection (User view)
  const userReviewedReq = {
    loading: false,
    error: "",
    data: {
      id: "rev-xss-user",
      rating: 5,
      content: maliciousPayload,
      created_at: "2026-10-10T00:00:00Z",
      hidden: false,
    },
    reload: () => {},
  };
  const { container: userContainer, unmount: unmountUser } = await mount(
    createElement(BookingReviewSection, {
      booking: { id: "b-xss", status: "COMPLETED" },
      area: "user",
      bookingReviewRequest: userReviewedReq,
      submitReview: () => {},
      rating: "5",
      setRating: () => {},
      review: "",
      setReview: () => {},
      reviewBusy: false,
    }),
  );

  // Assert in User DOM:
  assert.ok(userContainer.textContent.includes(maliciousPayload), "Payload must be rendered as literal text");
  assert.equal(userContainer.querySelector("script"), null, "No <script> element must exist in the DOM");
  assert.equal(userContainer.querySelector("img"), null, "No <img> element must be created from review content");
  assert.equal(dom.window.__xssScriptExecuted, false, "Script sentinel must not have been executed");
  assert.equal(dom.window.__xssImageExecuted, false, "Image onerror sentinel must not have been executed");

  await unmountUser();

  // 2. Test in ApiReviewsAdminPage (Admin view)
  const { container: adminContainer, unmount: unmountAdmin } = await mount(
    createElement(
      AuthProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: ["/admin/reviews"] },
        createElement(ApiReviewsAdminPage, null),
      ),
    ),
  );
  const adminReq = takeRequest("/admin/reviews");
  await act(async () => {
    fulfill(adminReq, [
      {
        id: "rev-xss-admin",
        bookingId: "b-xss-user",
        rating: 5,
        content: maliciousPayload,
        hidden: false,
        version: 0,
      },
    ]);
  });

  // Assert in Admin DOM:
  assert.ok(adminContainer.textContent.includes(maliciousPayload), "Payload must be rendered as literal text in admin view");
  assert.equal(adminContainer.querySelector("script"), null, "No <script> element in admin DOM");
  assert.equal(adminContainer.querySelector("img"), null, "No <img> element in admin DOM");
  assert.equal(dom.window.__xssScriptExecuted, false, "Script sentinel must remain unexecuted");
  assert.equal(dom.window.__xssImageExecuted, false, "Image onerror sentinel must remain unexecuted");

  await unmountAdmin();
});
