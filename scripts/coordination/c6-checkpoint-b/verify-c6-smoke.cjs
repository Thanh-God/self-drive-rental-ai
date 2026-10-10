const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = "E:/AI/BERT_Project/codepython/KLTN";

const runDir = process.env.RUN_DIR || process.argv[2];
if (!runDir) {
  throw new Error(
    "RUN_DIR must be explicitly provided via environment or argv[2].",
  );
}

process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
  root,
  ".runtime/phase5-rerun-20261004-1823/browsers",
);
const { chromium } = require(
  path.join(
    root,
    ".runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright",
  ),
);

const base = process.env.BASE_URL || "http://127.0.0.1:5225";
const apiBase = process.env.API_BASE_URL || "http://127.0.0.1:8125/api/v1";

async function main() {
  const logFile = path.join(runDir, "browser-smoke.log");
  function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    process.stdout.write(line);
    try {
      fs.appendFileSync(logFile, line, "utf8");
    } catch (e) {}
  }

  log(
    `Starting Playwright Browser Smoke Test (base=${base}, apiBase=${apiBase}, runDir=${runDir})...`,
  );

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const smokeResults = {
    TestName: "C6 Checkpoint B Browser Smoke Positive",
    UserReviewSubmit: false,
    UserReviewPersistOnReload: false,
    PublicReviewVisible: false,
    AdminHideReview: false,
    PublicReviewHidden: false,
    AdminShowReview: false,
    PublicReviewRestored: false,
    AllAssertionsPassed: false,
  };

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. User login
    log("Logging in as User (demo-user)...");
    await page.goto(`${base}/login`);
    await page.waitForLoadState("networkidle");
    await page.fill('input[type="email"]', "user@example.test");
    await page.fill(
      'input[type="password"]',
      "kdrive_seed_pw_c6_review_20261010",
    );
    await page.click('button:has-text("Đăng nhập")');
    await page.waitForLoadState("networkidle");
    await page.waitForFunction(() => !!localStorage.getItem("kdrive.jwt"), {
      timeout: 10000,
    });
    log("User login successful.");

    // Lấy completed booking
    const bookingRes = await fetch(`${apiBase}/bookings`, {
      headers: {
        Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("kdrive.jwt"))}`,
      },
    });
    const bookings = await bookingRes.json();
    const completedBooking =
      bookings.find((b) => b.id === "booking-e2e-completed-001") ||
      bookings.find((b) => b.status === "COMPLETED");
    if (!completedBooking) {
      throw new Error("No COMPLETED booking found for demo-user in fixture.");
    }
    const bookingId = completedBooking.id;
    log(`Testing with COMPLETED booking: ${bookingId}`);

    // Mở trang chi tiết booking
    await page.goto(`${base}/user/bookings/${bookingId}`);
    await page.waitForLoadState("networkidle");

    // Điền và gửi review
    log("Verifying review form is visible...");
    await page.waitForSelector('form:has-text("Đánh giá chuyến thuê")', {
      timeout: 5000,
    });
    await page.selectOption("select", "5");
    const reviewContent =
      "Trải nghiệm xe tuyệt vời và dịch vụ chu đáo Checkpoint B!";
    await page.fill("textarea", reviewContent);

    const submitBtn = await page.locator('button:has-text("Gửi đánh giá")');
    await submitBtn.click();
    log("Clicked submit review.");

    await page.waitForSelector('section:has-text("Đánh giá của bạn")', {
      timeout: 10000,
    });
    const renderedText = await page.textContent(
      'section:has-text("Đánh giá của bạn")',
    );
    assert.ok(renderedText.includes("5/5 sao"), "Rendered 5/5 sao");
    assert.ok(renderedText.includes(reviewContent), "Rendered review content");
    smokeResults.UserReviewSubmit = true;
    log("User review submitted successfully.");

    // Reload trang xác nhận persist
    log("Reloading booking detail page...");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForSelector('section:has-text("Đánh giá của bạn")', {
      timeout: 5000,
    });
    const reloadedText = await page.textContent(
      'section:has-text("Đánh giá của bạn")',
    );
    assert.ok(
      reloadedText.includes("5/5 sao"),
      "Reloaded page displays 5/5 sao",
    );
    assert.ok(
      reloadedText.includes(reviewContent),
      "Reloaded page displays review content",
    );
    const formCount = await page
      .locator('form:has-text("Đánh giá chuyến thuê")')
      .count();
    assert.equal(
      formCount,
      0,
      "Form đánh giá không được hiển thị lại sau khi đã đánh giá",
    );
    smokeResults.UserReviewPersistOnReload = true;
    log("User review persisted after reload.");
    await page.screenshot({
      path: path.join(runDir, "user-booking-reviewed.png"),
    });

    // 2. Public vehicle detail view
    const vehicleId = completedBooking.vehicleId;
    log(`Checking public vehicle detail page: ${vehicleId}...`);
    await page.goto(`${base}/vehicles/${vehicleId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForSelector(`article:has-text("${reviewContent}")`, {
      timeout: 5000,
    });
    const publicArticle = await page.textContent(
      `article:has-text("${reviewContent}")`,
    );
    assert.ok(
      publicArticle.includes(reviewContent),
      "Public view displays review content",
    );
    assert.ok(
      publicArticle.includes("5/5 sao"),
      "Public view displays 5/5 sao",
    );
    assert.ok(
      !publicArticle.includes(bookingId),
      "Public view does not expose bookingId",
    );
    smokeResults.PublicReviewVisible = true;
    log("Public review visible and private fields protected.");
    await page.screenshot({
      path: path.join(runDir, "vehicle-public-review.png"),
    });

    // 3. Admin moderation: Hide
    log("Logging in as Admin (demo-admin)...");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto(`${base}/login`);
    await page.waitForLoadState("networkidle");
    await page.fill('input[type="email"]', "admin@example.test");
    await page.fill(
      'input[type="password"]',
      "kdrive_seed_pw_c6_review_20261010",
    );
    await page.click('button:has-text("Đăng nhập")');
    await page.waitForLoadState("networkidle");
    await page.waitForFunction(() => !!localStorage.getItem("kdrive.jwt"), {
      timeout: 10000,
    });

    await page.goto(`${base}/admin/reviews`);
    await page.waitForLoadState("networkidle");
    await page.waitForSelector(`article:has-text("${reviewContent}")`, {
      timeout: 5000,
    });

    log("Admin hiding review...");
    await page.click(
      `article:has-text("${reviewContent}") button:has-text("Ẩn đánh giá")`,
    );
    await page.waitForSelector(
      `article:has-text("${reviewContent}") button:has-text("Hiển thị")`,
      { timeout: 5000 },
    );
    smokeResults.AdminHideReview = true;
    log("Review hidden by admin.");
    await page.screenshot({
      path: path.join(runDir, "admin-review-hidden.png"),
    });

    // Kiểm tra public xe: review phải bị ẩn
    await page.goto(`${base}/vehicles/${vehicleId}`);
    await page.waitForLoadState("networkidle");
    const hiddenCount = await page
      .locator(`article:has-text("${reviewContent}")`)
      .count();
    assert.equal(hiddenCount, 0, "Public view must not show hidden review");
    smokeResults.PublicReviewHidden = true;
    log("Verified public vehicle page: hidden review is absent.");

    // 4. Admin moderation: Show (Khôi phục hiển thị)
    log("Admin showing review again...");
    await page.goto(`${base}/admin/reviews`);
    await page.waitForLoadState("networkidle");
    await page.click(
      `article:has-text("${reviewContent}") button:has-text("Hiển thị")`,
    );
    await page.waitForSelector(
      `article:has-text("${reviewContent}") button:has-text("Ẩn đánh giá")`,
      { timeout: 5000 },
    );
    smokeResults.AdminShowReview = true;
    log("Review restored to public visibility by admin.");

    // Kiểm tra public xe: review hiển thị lại
    await page.goto(`${base}/vehicles/${vehicleId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForSelector(`article:has-text("${reviewContent}")`, {
      timeout: 5000,
    });
    smokeResults.PublicReviewRestored = true;
    log("Verified public vehicle page: review is restored and visible.");

    smokeResults.AllAssertionsPassed = true;
    log("=== ALL BROWSER SMOKE POSITIVE ASSERTIONS PASSED ===");
  } finally {
    await browser.close();
    const resultOut = path.join(runDir, "browser-smoke-results.json");
    fs.writeFileSync(resultOut, JSON.stringify(smokeResults, null, 2), "utf8");
  }
}

main().catch((err) => {
  console.error("Browser smoke test failed:", err);
  process.exit(1);
});
