const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  deferred,
  dispatcher,
  bounded,
  assertNoUnexpected,
} = require("./browser-controls.cjs");

const playwrightModule =
  process.env.C8B_PLAYWRIGHT_MODULE ||
  path.resolve(
    __dirname,
    "../../../.runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright",
  );
const { chromium } = require(playwrightModule);

const evidence = process.env.C8B_EVIDENCE_DIR;
const api = process.env.C8B_API_BASE_URL;
const base = process.env.C8B_BASE_URL;
const browserApi = `${base}/api/v1`;
const container = process.env.C8B_CONTAINER;
const schema = process.env.C8B_SCHEMA;
const markerSchema = process.env.C8B_MARKER_SCHEMA;
const markerToken = process.env.C8B_MARKER_TOKEN;
const dbPassword = process.env.C8B_DB_PASSWORD;
const seedPassword = process.env.C8B_SEED_PASSWORD;

const checks = [];
const http = [];
const consoleIssues = [];
const expected = [];

let browser;

const q = (value) => `'${String(value).replaceAll("'", "''")}'`;

function sql(query) {
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-e",
      `MYSQL_PWD=${dbPassword}`,
      container,
      "mysql",
      "-uroot",
      "--batch",
      "--raw",
      "--skip-column-names",
      "-e",
      `USE ${schema}; ${query}`,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `SQL failed (${result.status}): ${result.stderr.replaceAll(dbPassword, "[REDACTED]")}`,
    );
  }
  return result.stdout.trim();
}

function record(name, actual, wanted) {
  assert.deepEqual(actual, wanted, name);
  checks.push({ name, actual, expected: wanted, passed: true });
  console.log(`PASS ${name}`);
}

function write(filename, data) {
  if (evidence) {
    fs.writeFileSync(
      path.join(evidence, filename),
      JSON.stringify(data, null, 2),
    );
  }
}

function monitor(target) {
  target.on("response", (r) => {
    if (r.status() >= 400) {
      http.push({
        method: r.request().method(),
        url: r.url(),
        status: r.status(),
      });
    }
  });
  target.on("requestfailed", (r) => {
    http.push({
      method: r.method(),
      url: r.url(),
      failure: r.failure()?.errorText,
    });
  });
  target.on("console", (m) => {
    if (m.type() === "error") {
      consoleIssues.push({
        type: "console",
        text: m.text(),
        url: m.location().url,
      });
    }
  });
  target.on("pageerror", (e) => {
    consoleIssues.push({ type: "pageerror", text: e.message });
  });
}

async function loginApi(email, password = seedPassword) {
  const response = await fetch(`${api}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  return { status: response.status, data };
}

async function main() {
  assert.ok(
    evidence && api && base && dbPassword && seedPassword,
    "Missing environment variables",
  );

  // Verify isolated fixture marker
  const markerCount = sql(
    `SELECT COUNT(*) FROM ${markerSchema}.__kdrive_test_fixture_marker WHERE id=1 AND target_schema=${q(schema)} AND marker_token=${q(markerToken)};`,
  );
  record("isolated fixture marker verified", markerCount, "1");

  // Ensure inactive branch exists for inactive label mapping check (use ASCII to avoid encoding differences across environments)
  sql(
    `INSERT IGNORE INTO branches(id, name, address, status, version) VALUES('br-inactive', 'Inactive Branch', '789 Duong Tam, TP.HCM', 'INACTIVE', 0);`,
  );

  // Admin login API
  const adminLogin = await loginApi("admin@example.test");
  record("Admin login successful", adminLogin.status, 200);
  const adminToken = adminLogin.data.token;

  browser = await chromium.launch({ headless: true });

  // =========================================================================
  // Requirement 1: Admin creates Staff, held response proof, duplicate 409, RBAC
  // =========================================================================
  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await adminContext.addInitScript(
    ({ token }) => {
      localStorage.setItem("kdrive.jwt", token);
    },
    { token: adminToken },
  );

  const scenarios = new Map();
  await adminContext.route("**/api/v1/**", dispatcher(scenarios));

  const page = await adminContext.newPage();
  monitor(page);
  page.setDefaultTimeout(15000);

  // Navigate to accounts page
  await page.goto(`${base}/admin/accounts`);
  await page
    .getByRole("heading", { name: "Quản lý tài khoản", exact: true })
    .waitFor();
  record("Admin navigates to Accounts page", true, true);

  // Form elements
  const createForm = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "Tạo nhân viên" }) });
  await createForm.waitFor();

  const fullNameInput = createForm.locator('input[name="fullName"]');
  const emailInput = createForm.locator('input[name="email"]');
  const passwordInput = createForm.locator('input[name="password"]');
  const createBtn = createForm.locator('button[type="submit"]');

  const staffEmail = `staff.browser.${Date.now()}@kdrive.test`;
  const staffPass = "StaffLive123!";
  const staffName = "Nhân viên Live Browser";

  await fullNameInput.fill(staffName);
  await emailInput.fill(staffEmail);
  await passwordInput.fill(staffPass);

  // Set up held response scenario for create staff POST
  const createScenarioKey = `POST ${browserApi}/admin/accounts`;
  const createReached = deferred();
  const createRelease = deferred();
  const createFinished = deferred();
  scenarios.set(createScenarioKey, {
    reached: createReached,
    release: createRelease,
    finished: createFinished,
    count: 0,
  });

  // Submit form
  await createBtn.click();
  await bounded(createReached.promise, "create staff request reached backend");

  // Verify button is busy / disabled
  record(
    "Create button is disabled while pending",
    await createBtn.isDisabled(),
    true,
  );
  record(
    "Create button text shows busy state",
    (await createBtn.textContent()).trim(),
    "Đang tạo...",
  );

  // Second click while pending (demonstrate synchronous guard holds double dispatch)
  await createBtn.click({ force: true }).catch(() => {});

  // Release response
  createRelease.resolve();
  await bounded(createFinished.promise, "create staff response fulfilled");
  record(
    "Synchronous guard prevented double submit for create staff",
    scenarios.get(createScenarioKey).count,
    1,
  );

  // Wait for success notice
  await page.getByText("Đã tạo tài khoản Staff.").waitFor();
  record("Create staff success notice visible", true, true);

  // Verify in MySQL
  const userCount = sql(
    `SELECT COUNT(*) FROM users WHERE email=${q(staffEmail)} AND role='STAFF' AND status='ACTIVE';`,
  );
  record(
    "Created staff account exists in MySQL with role STAFF and status ACTIVE",
    userCount,
    "1",
  );

  const staffId = sql(`SELECT id FROM users WHERE email=${q(staffEmail)};`);
  assert.ok(staffId, "staffId must exist");

  // Negative test: Duplicate email submission returns 409
  expected.push({
    method: "POST",
    url: `${browserApi}/admin/accounts`,
    status: 409,
  });
  await fullNameInput.fill(staffName);
  await emailInput.fill(staffEmail);
  await passwordInput.fill(staffPass);
  scenarios.delete(createScenarioKey); // allow normal dispatch
  await createBtn.click();

  await page.waitForFunction(
    () =>
      document.querySelector(
        '.bg-rose-50, .border-rose-200, [class*="error"]',
      ) !== null,
  );
  record("Duplicate account submission shows error notice", true, true);
  const duplicateUserCount = sql(
    `SELECT COUNT(*) FROM users WHERE email=${q(staffEmail)};`,
  );
  record(
    "No duplicate user row created in MySQL on 409",
    duplicateUserCount,
    "1",
  );

  // RBAC Negative: USER cannot access /admin/accounts
  const userRegistration = await fetch(`${api}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `user.neg.${Date.now()}@example.test`,
      fullName: "User Negative",
      password: "UserNeg123!",
    }),
  });
  record("User registration status", userRegistration.status, 201);
  const userData = await userRegistration.json();

  expected.push({ method: "GET", url: `${api}/admin/accounts`, status: 403 });
  const directApiAccess = await fetch(`${api}/admin/accounts`, {
    headers: { authorization: `Bearer ${userData.token}` },
  });
  record(
    "USER direct GET /admin/accounts returns 403 Forbidden",
    directApiAccess.status,
    403,
  );

  const negativeLinks=sql("SELECT COUNT(*) FROM staff_branches;");
  for(const [name,payload,status] of [
    ["nonStaff",{userId:userData.user.id,branchId:"hn"},400],
    ["missingBranch",{userId:staffId,branchId:"does-not-exist"},404],
    ["inactiveBranch",{userId:staffId,branchId:"br-inactive"},409]]) {
    const response=await fetch(`${api}/admin/staff-branches`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${adminToken}`},body:JSON.stringify(payload)});
    record(`Invalid assignment ${name}`,response.status,status);
  }
  record("Invalid assignments preserve all links",sql("SELECT COUNT(*) FROM staff_branches;"),negativeLinks);
  const beforeInvalid=sql("SELECT COUNT(*) FROM users;");
  const invalid=await fetch(`${api}/admin/accounts`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${adminToken}`},body:JSON.stringify({email:"invalid@test",fullName:"Invalid",password:"tiny"})});
  record("Backend invalid staff password rejected",invalid.status,400);
  record("Invalid create writes no row",sql("SELECT COUNT(*) FROM users;"),beforeInvalid);
  // User browser context direct URL navigation
  const userContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await userContext.addInitScript(
    ({ token }) => {
      localStorage.setItem("kdrive.jwt", token);
    },
    { token: userData.token },
  );
  const userPage = await userContext.newPage();
  monitor(userPage);
  await userPage.goto(`${base}/admin/accounts`);
  await userPage.waitForTimeout(1000);
  const userCannotSeeAdminAccounts = (
    await userPage.locator("h1, h2").allTextContents()
  ).every((t) => !t.includes("Quản lý tài khoản"));
  record(
    "USER redirected or denied on /admin/accounts direct URL",
    userCannotSeeAdminAccounts,
    true,
  );
  await userContext.close();

  // =========================================================================
  // Requirement 2: Assign two branches, reload persistence, bulk 500 retry
  // =========================================================================
  // Locate the article panel for newly created staff
  const staffArticle = page
    .locator("article.panel")
    .filter({ has: page.getByText(staffEmail) });
  await staffArticle.waitFor();

  // 1. Assign first branch ('hn' - Chi nhánh Hà Nội)
  const assignForm = staffArticle
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Gán chi nhánh" }) });
  await assignForm.waitFor();

  const branchSelect = assignForm.locator('select[name="branchId"]');
  const assignBtn = assignForm.locator('button[type="submit"]');

  await branchSelect.selectOption("hn");
  await assignBtn.click();

  await page.getByText(`Đã gán chi nhánh cho ${staffName}.`).waitFor();
  await staffArticle.locator('text=/Hà Nội/').first().waitFor();
  record("First branch (Hà Nội) assigned and badge displayed", true, true);

  const hnLinkSql = sql(
    `SELECT COUNT(*) FROM staff_branches WHERE user_id=${q(staffId)} AND branch_id='hn';`,
  );
  record("First branch link persisted in MySQL", hnLinkSql, "1");

  // 2. Assign second branch ('dn' - Chi nhánh Đà Nẵng) with held response proof
  const assignScenarioKey = `POST ${browserApi}/admin/staff-branches`;
  const assignReached = deferred();
  const assignRelease = deferred();
  const assignFinished = deferred();
  scenarios.set(assignScenarioKey, {
    reached: assignReached,
    release: assignRelease,
    finished: assignFinished,
    count: 0,
  });

  await branchSelect.selectOption("dn");
  await assignBtn.click();
  await bounded(assignReached.promise, "assign branch request reached backend");

  record(
    "Assign button is disabled while pending",
    await assignBtn.isDisabled(),
    true,
  );
  await assignBtn.click({ force: true }).catch(() => {});

  assignRelease.resolve();
  await bounded(assignFinished.promise, "assign branch response fulfilled");
  record(
    "Synchronous guard prevented double submit for assign branch",
    scenarios.get(assignScenarioKey).count,
    1,
  );
  scenarios.delete(assignScenarioKey);

  await staffArticle.locator('text=/Đà Nẵng/').first().waitFor();
  record("Second branch (Đà Nẵng) assigned and badge displayed", true, true);

  const totalLinksSql = sql(
    `SELECT COUNT(*) FROM staff_branches WHERE user_id=${q(staffId)};`,
  );
  record("Two branch links exist in MySQL for staff", totalLinksSql, "2");

  // 3. Repeated assignment idempotent check (backend C8A contract: returns 200 without duplicate SQL row)
  const repeatAssign = await fetch(`${api}/admin/staff-branches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ userId: staffId, branchId: "hn" }),
  });
  record(
    "Repeated assignment returns 200 OK idempotently",
    repeatAssign.status,
    200,
  );
  const afterRepeatSql = sql(
    `SELECT COUNT(*) FROM staff_branches WHERE user_id=${q(staffId)};`,
  );
  record(
    "Repeated assignment did not create duplicate SQL row",
    afterRepeatSql,
    "2",
  );

  // 4. Persistence after page reload
  await page.reload();
  await staffArticle.waitFor();
  await staffArticle.locator('text=/Hà Nội/').first().waitFor();
  await staffArticle.locator('text=/Đà Nẵng/').first().waitFor();
  record("Assigned branch labels persist across page reload", true, true);

  // 5. Inactive branch assignment label check
  sql(
    `INSERT IGNORE INTO staff_branches(user_id, branch_id) VALUES(${q(staffId)}, 'br-inactive');`,
  );
  await page.reload();
  await staffArticle.locator('span, .badge').filter({ hasText: 'Inactive Branch' }).filter({ hasText: 'tạm ngừng' }).first().waitFor();
  record("Inactive branch label rendered with (tạm ngừng) notice", true, true);
  sql(
    `DELETE FROM staff_branches WHERE user_id=${q(staffId)} AND branch_id='br-inactive';`,
  );

  // 6. Bulk GET 500 error & Retry button
  const bulkScenarioKey = `GET ${browserApi}/admin/staff-branches`;
  expected.push({
    method: "GET",
    url: `${browserApi}/admin/staff-branches`,
    status: 500,
  });
  scenarios.set(bulkScenarioKey, {
    error: 500,
    message: "Lỗi nạp danh sách chi nhánh",
  });

  await page.reload();
  await page.getByRole("button", { name: "Thử tải lại" }).waitFor();
  record("Bulk staff-branches 500 error displays retry button", true, true);

  scenarios.delete(bulkScenarioKey);
  await page.getByRole("button", { name: "Thử tải lại" }).click();

  await staffArticle.waitFor();
  await staffArticle.locator('text=/Hà Nội/').first().waitFor();
  record(
    "Retry button recovers and displays branch labels correctly",
    true,
    true,
  );

  // =========================================================================
  // Requirement 3: Separate Staff context, lock 401, unlock lifecycle
  // =========================================================================
  // Staff initial login
  const staffLoginRes = await loginApi(staffEmail, staffPass);
  record("Staff initial login returns 200 OK", staffLoginRes.status, 200);
  const staffToken1 = staffLoginRes.data.token;

  // Verify staff can access /api/v1/me/branches
  const staffBranchesRes1 = await fetch(`${api}/me/branches`, {
    headers: { authorization: `Bearer ${staffToken1}` },
  });
  record(
    "Staff accesses /me/branches successfully with token 1",
    staffBranchesRes1.status,
    200,
  );
  const assignedMe = await staffBranchesRes1.json();
  record(
    "Staff /me/branches returns exactly 2 assigned branches",
    assignedMe.length,
    2,
  );

  // Staff browser context
  const staffContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await staffContext.addInitScript(
    ({ token }) => {
      localStorage.setItem("kdrive.jwt", token);
    },
    { token: staffToken1 },
  );
  const staffPage = await staffContext.newPage();
  monitor(staffPage);
  await staffContext.route("**/api/v1/**", dispatcher(new Map()));
  await staffPage.goto(`${base}/staff/queue`);
  await staffPage.waitForURL("**/staff/queue");
  await staffPage.waitForFunction(() => localStorage.getItem("kdrive.user") !== null);
  record("Staff authenticated application before lock", new URL(staffPage.url()).pathname, "/staff/queue");
  const staffAdmin = await fetch(`${api}/admin/accounts`, {headers:{authorization:`Bearer ${staffToken1}`}});
  record("Staff admin API forbidden", staffAdmin.status, 403);
  await staffPage.waitForLoadState("networkidle");
  await staffPage.goto(`${base}/admin/accounts`);
  await staffPage.waitForURL(url => url.pathname !== "/admin/accounts");
  record("Staff admin page denied", new URL(staffPage.url()).pathname !== "/admin/accounts", true);
  await staffPage.waitForLoadState("networkidle");

  const patchKey = `PATCH ${browserApi}/admin/accounts/${staffId}`;
  expected.push({method:"PATCH",url:`${browserApi}/admin/accounts/${staffId}`,status:500});
  scenarios.set(patchKey,{error:500,message:"Status failure control",count:0});
  await staffArticle.getByRole("button",{name:"Khóa tài khoản",exact:true}).click();
  await page.getByText("Status failure control",{exact:true}).waitFor();
  record("Failed status leaves SQL unchanged",sql(`SELECT status,version FROM users WHERE id=${q(staffId)};`),"ACTIVE\t1");
  scenarios.delete(patchKey);
  const patchReached=deferred(), patchRelease=deferred(), patchFinished=deferred();
  scenarios.set(patchKey,{reached:patchReached,release:patchRelease,finished:patchFinished,count:0});
  // Admin locks Staff account via UI
  const lockBtn = staffArticle
    .locator("button.btn-secondary")
    .filter({ hasText: "Khóa tài khoản" });
  await lockBtn.click();
  await bounded(patchReached.promise,"status reached backend");
  record("Status disabled while held",await lockBtn.isDisabled(),true);
  await lockBtn.evaluate(button => {button.click(); button.click();});
  record("One status PATCH while held",scenarios.get(patchKey).count,1);
  patchRelease.resolve();
  await bounded(patchFinished.promise,"status fulfilled");
  scenarios.delete(patchKey);
  await page
    .getByText(`Đã cập nhật trạng thái tài khoản ${staffEmail}.`)
    .waitFor();
  await staffArticle.getByText("LOCKED").waitFor();
  record("Admin locks staff account via UI", true, true);

  const lockedSql = sql(
    `SELECT status, version FROM users WHERE id=${q(staffId)};`,
  );
  record(
    "Staff account status is LOCKED and version incremented in MySQL",
    lockedSql,
    "LOCKED\t2",
  );

  expected.push({method:"GET",url:`${browserApi}/auth/me`,status:401});
  await staffPage.reload();
  await staffPage.waitForURL("**/login");
  record("Locked Staff application redirects login", new URL(staffPage.url()).pathname, "/login");
  record("Locked Staff token cleared", await staffPage.evaluate(() => localStorage.getItem("kdrive.jwt")), null);
  await staffPage.locator('input[name="email"]').fill(staffEmail);
  await staffPage.locator('input[name="password"]').fill(staffPass);
  expected.push({method:"POST",url:`${browserApi}/auth/login`,status:401});
  await staffPage.getByRole("button",{name:"Đăng nhập",exact:true}).click();
  await staffPage.locator("form p").waitFor();
  record("Locked Staff UI login remains unauthenticated", await staffPage.evaluate(() => localStorage.getItem("kdrive.jwt")), null);
  // Next protected request with old staff token receives 401
  expected.push({ method: "GET", url: `${api}/me/branches`, status: 401 });
  const staffLockedRequest = await fetch(`${api}/me/branches`, {
    headers: { authorization: `Bearer ${staffToken1}` },
  });
  record(
    "Protected request with token 1 returns 401 Unauthorized after lock",
    staffLockedRequest.status,
    401,
  );

  // Locked staff cannot login (returns 401)
  expected.push({ method: "POST", url: `${api}/auth/login`, status: 401 });
  const lockedLoginRes = await loginApi(staffEmail, staffPass);
  record(
    "Locked staff login returns 401 Unauthorized",
    lockedLoginRes.status,
    401,
  );

  // Admin unlocks Staff account via UI
  const unlockBtn = staffArticle
    .locator("button.btn-secondary")
    .filter({ hasText: "Mở khóa" });
  await unlockBtn.click();
  await page
    .getByText(`Đã cập nhật trạng thái tài khoản ${staffEmail}.`)
    .waitFor();
  await staffArticle.getByText("ACTIVE").waitFor();
  record("Admin unlocks staff account via UI", true, true);

  const unlockedSql = sql(
    `SELECT status, version FROM users WHERE id=${q(staffId)};`,
  );
  record(
    "Staff account status is ACTIVE and version incremented in MySQL",
    unlockedSql,
    "ACTIVE\t3",
  );

  // Old token 1 still returns 401 (tokens are not retroactively un-revoked)
  expected.push({ method: "GET", url: `${api}/me/branches`, status: 401 });
  const oldTokenAfterUnlock = await fetch(`${api}/me/branches`, {
    headers: { authorization: `Bearer ${staffToken1}` },
  });
  record(
    "Old token 1 remains 401 Unauthorized after unlock",
    oldTokenAfterUnlock.status,
    401,
  );

  await staffPage.getByRole("button",{name:"Đăng nhập",exact:true}).click();
  await staffPage.waitForURL("**/staff/queue");
  record("Unlocked Staff UI login succeeds", new URL(staffPage.url()).pathname, "/staff/queue");
  record("Fresh UI token differs from revoked token", await staffPage.evaluate(old => localStorage.getItem("kdrive.jwt") !== old, staffToken1), true);
  // New login succeeds and issues token 2
  const newStaffLoginRes = await loginApi(staffEmail, staffPass);
  record(
    "New staff login after unlock returns 200 OK",
    newStaffLoginRes.status,
    200,
  );
  const staffToken2 = newStaffLoginRes.data.token;

  // New token accesses /me/branches with all assignments preserved
  const staffBranchesRes2 = await fetch(`${api}/me/branches`, {
    headers: { authorization: `Bearer ${staffToken2}` },
  });
  record(
    "New token 2 accesses /me/branches with 200 OK",
    staffBranchesRes2.status,
    200,
  );
  const assignedMe2 = await staffBranchesRes2.json();
  record(
    "Assigned branches preserved in /me/branches after unlock",
    assignedMe2.length,
    2,
  );

  await staffPage.waitForLoadState("networkidle");
  await staffContext.close();

  // =========================================================================
  // Requirement 4: Stale version 409 / refetch and no overwrite
  // =========================================================================
  // Currently account version in UI state is 3 (created=1, locked=2, unlocked=3).
  // Simulate concurrent update by another operator directly bumping version to 4
  sql(`UPDATE users SET version=4 WHERE id=${q(staffId)};`);

  expected.push({
    method: "PATCH",
    url: `${browserApi}/admin/accounts/${staffId}`,
    status: 409,
  });
  // Admin clicks lock button on UI (sending old version 3)
  await lockBtn.click();

  await page.locator('.notice-error, [role="alert"]').first().waitFor();
  record("Stale version 409 conflict displays error notice", true, true);

  const staleDbState = sql(
    `SELECT status, version FROM users WHERE id=${q(staffId)};`,
  );
  record(
    "MySQL data was not overwritten on stale 409 conflict",
    staleDbState,
    "ACTIVE\t4",
  );

  // Reload page to fetch latest version (4)
  await page.reload();
  await staffArticle.waitFor();
  const refreshedLockBtn = staffArticle
    .locator("button.btn-secondary")
    .filter({ hasText: "Khóa tài khoản" });
  await refreshedLockBtn.click();

  await page
    .getByText(`Đã cập nhật trạng thái tài khoản ${staffEmail}.`)
    .waitFor();
  const finalDbState = sql(
    `SELECT status, version FROM users WHERE id=${q(staffId)};`,
  );
  record(
    "Lock succeeds after fetching latest version (version incremented in MySQL)",
    finalDbState,
    "LOCKED\t5",
  );

  // Screenshot final verified UI state
  if (evidence) {
    await page.screenshot({
      path: path.join(evidence, "accounts-page-final.png"),
      fullPage: true,
    });
  }

  // =========================================================================
  // Requirement 5: Assert no unexpected HTTP/console issues & write evidence
  // =========================================================================
  assertNoUnexpected(http, consoleIssues, expected);
  record("All HTTP and console errors classified and expected", true, true);

  write("browser-checks.json", checks);
  write("browser-http.json", http);
  write("browser-console.json", consoleIssues);
  console.log(`\nALL ${checks.length} BROWSER CHECKS PASSED SUCCESSFULLY.`);

  await adminContext.close();
  await browser.close();
}

main().catch((err) => {
  console.error("BROWSER VERIFICATION FAILED:", err);
  if (evidence) {
    write("browser-failure.json", { error: err.message, stack: err.stack });
  }
  if (browser) browser.close().catch(() => {});
  process.exit(1);
});
