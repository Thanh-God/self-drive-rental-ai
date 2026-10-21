const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require(path.resolve('.runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright'));

const base = process.env.KDRIVE_BASE_URL || 'http://localhost:5173';
const apiBase = process.env.KDRIVE_API_BASE_URL || 'http://127.0.0.1:8080/api/v1';
const out = path.resolve(process.argv[2] || '.runtime/ux-desktop-improvement-fix-20261021-112200');
if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });

const observations = [];
const consoleLogs = [];
const errors = [];
const network = [];

function check(name, actual, expected = true) {
  assert.deepEqual(actual, expected, name);
  observations.push({ name, actual, expected, pass: true });
}

async function assertCleanScreen(p, screenName) {
  assert.equal(errors.length, 0, `Unhandled page errors at ${screenName}: ${errors.join('; ')}`);
  const errLogs = consoleLogs.filter(c => c.type === 'error');
  assert.equal(errLogs.length, 0, `Console errors at ${screenName}: ${JSON.stringify(errLogs)}`);
  const overlayCount = await p.locator('vite-error-overlay').count();
  assert.equal(overlayCount, 0, `Vite error overlay detected at ${screenName}`);
}

(async () => {
  // Setup temporary extension for real 125% browser zoom
  const extDir = path.join(out, 'zoom-extension');
  if (!fs.existsSync(extDir)) fs.mkdirSync(extDir, { recursive: true });
  fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'KDrive Real 125 Zoom Verification',
    version: '1.0',
    host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'],
    background: { service_worker: 'background.js' }
  }));
  fs.writeFileSync(path.join(extDir, 'background.js'), 'chrome.runtime.onInstalled.addListener(() => {});');

  const profileDir = path.join(out, 'chrome-profile');
  const ctx = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    locale: 'vi-VN',
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`]
  });

  try {
    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    assert.ok(sw, 'Service worker loaded for real zoom control');

    const p = await ctx.newPage();
    p.setDefaultTimeout(15000);

    p.on('pageerror', e => {
      errors.push(e.message);
      console.error('PAGEERROR:', e.message);
    });

    p.on('console', m => {
      if (['error', 'warning'].includes(m.type())) {
        consoleLogs.push({ type: m.type(), text: m.text() });
        if (m.type() === 'error') {
          console.error('CONSOLE_ERROR:', m.text());
        }
      }
    });

    p.on('response', r => {
      if (r.url().includes('/api/v1/')) {
        network.push({
          method: r.request().method(),
          path: new URL(r.url()).pathname,
          status: r.status()
        });
      }
    });

    // Helper to apply real browser zoom via extension
    async function setRealZoom(zoomFactor) {
      const zoom = await sw.evaluate(async (factor) => {
        const tabs = await chrome.tabs.query({});
        const target = tabs.find(t => t.url && (t.url.includes('5173') || t.url.includes('localhost')));
        if (!target) return null;
        await chrome.tabs.setZoom(target.id, factor);
        return chrome.tabs.getZoom(target.id);
      }, zoomFactor);
      await p.waitForTimeout(350);
      const dpr = await p.evaluate(() => window.devicePixelRatio);
      return { zoom, dpr };
    }

    // -------------------------------------------------------------
    // 1. NHÓM 4 (UX03): Desktop Navbar (GUEST) & Rental Guide
    // -------------------------------------------------------------
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.goto(base);
    await p.getByRole('heading', { name: /Mỗi chuyến đi/ }).waitFor();
    await assertCleanScreen(p, 'Home page (Guest)');

    const desktopNavGuide = p.locator('header nav a[href="/rental-guide"]');
    check('Guest desktop header has /rental-guide link', await desktopNavGuide.count(), 1);
    check('Guest desktop header /rental-guide label is Hướng dẫn thuê xe', (await desktopNavGuide.textContent()).trim(), 'Hướng dẫn thuê xe');

    const guideBox = await desktopNavGuide.boundingBox();
    check('Guide link visible in initial viewport', guideBox.y >= 0 && guideBox.y < 100);

    await desktopNavGuide.click();
    await p.getByRole('heading', { name: 'Hướng dẫn thuê xe', exact: true }).waitFor();
    check('Guest navigated to /rental-guide in 1 click', new URL(p.url()).pathname, '/rental-guide');
    await assertCleanScreen(p, 'Rental Guide page (Guest)');

    const stepCount = await p.locator('ol > li').count();
    check('Rental guide has 7 steps', stepCount, 7);
    const faq = p.locator('summary').filter({ hasText: 'Giá thuê được tính thế nào?' });
    await faq.click();
    check('FAQ expands on click', await faq.evaluate(e => e.parentElement.open), true);
    await p.screenshot({ path: path.join(out, 'browser-guide-guest-desktop-1440.png') });

    // -------------------------------------------------------------
    // 2. NHÓM 4 (UX03): Desktop Navbar (AUTHENTICATED USER SESSION)
    // -------------------------------------------------------------
    let userPassword = process.env.KDRIVE_USER_PASSWORD;
    if (!userPassword && fs.existsSync('backend/.env.local')) {
      const env = fs.readFileSync('backend/.env.local', 'utf8');
      userPassword = env.match(/^SEED_PASSWORD=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
    }
    assert.ok(userPassword, 'Seed password required for user authentication');

    const userLoginRes = await fetch(apiBase + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.test', password: userPassword })
    });
    assert.equal(userLoginRes.status, 200, 'User login failed');
    const { token: userToken, user: userProfile } = await userLoginRes.json();
    assert.ok(userToken, 'User token required');

    // Store token and user profile in browser localStorage and reload
    await p.evaluate(({ jwt, user }) => {
      localStorage.setItem('kdrive.jwt', jwt);
      localStorage.setItem('kdrive.user', JSON.stringify(user));
    }, { jwt: userToken, user: userProfile });
    await p.goto(base);
    await p.getByRole('heading', { name: /Mỗi chuyến đi/ }).waitFor();
    await assertCleanScreen(p, 'Home page (USER)');

    // Verify authenticated desktop navigation items
    const userNavBookings = p.locator('header nav a[href="/user/bookings"]');
    await userNavBookings.waitFor({ timeout: 5000 });
    check('USER desktop header has /user/bookings link', await userNavBookings.count(), 1);
    check('USER bookings link label is Đơn thuê của tôi', (await userNavBookings.textContent()).trim(), 'Đơn thuê của tôi');

    const userNavGuide = p.locator('header nav a[href="/rental-guide"]');
    check('USER desktop header has /rental-guide link', await userNavGuide.count(), 1);
    check('USER desktop header /rental-guide label is Hướng dẫn thuê xe', (await userNavGuide.textContent()).trim(), 'Hướng dẫn thuê xe');

    const userNavVehicles = p.locator('header nav a[href="/vehicles"]');
    check('USER desktop header has /vehicles link', await userNavVehicles.count(), 1);

    const userNavProfile = p.locator('header nav a[href="/user/profile"]');
    check('USER desktop header has /user/profile link', await userNavProfile.count(), 1);
    check('USER profile link label is Hồ sơ & GPLX', (await userNavProfile.textContent()).trim(), 'Hồ sơ & GPLX');

    // Click guide link from USER navbar to confirm 1-click navigation
    await userNavGuide.click();
    await p.getByRole('heading', { name: 'Hướng dẫn thuê xe', exact: true }).waitFor();
    check('USER navigated to /rental-guide in 1 click', new URL(p.url()).pathname, '/rental-guide');
    await assertCleanScreen(p, 'Rental Guide page (USER)');
    await p.screenshot({ path: path.join(out, 'browser-guide-user-desktop-1440.png') });

    // -------------------------------------------------------------
    // 3. NHÓM 2 (UX02a): Register copy & password hint
    // -------------------------------------------------------------
    for (const size of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
      await p.setViewportSize(size);
      await p.goto(base + '/register');
      await p.getByRole('heading', { name: 'Đăng ký tài khoản', exact: true }).waitFor();
      await assertCleanScreen(p, `Register page at ${size.width}`);

      const friendlyCopy = await p.getByText('Tạo tài khoản để đặt xe và theo dõi đơn thuê.', { exact: true }).isVisible();
      check(`Register page friendly copy at ${size.width}`, friendlyCopy, true);

      const hasUserJargon = await p.getByText(/Tài khoản mới nhận vai trò khách hàng \(USER\)/).count();
      check(`No raw USER copy at ${size.width}`, hasUserJargon, 0);

      const hasUtf8Jargon = await p.getByText(/byte UTF-8/).count();
      check(`No UTF-8 byte copy at ${size.width}`, hasUtf8Jargon, 0);

      const hint = await p.getByText('Ít nhất 8 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt.', { exact: true }).isVisible();
      check(`Password hint clear at ${size.width}`, hint, true);

      await p.screenshot({ path: path.join(out, `browser-register-${size.width}.png`) });
    }

    // -------------------------------------------------------------
    // 4. NHÓM 1 (UX01): Vehicle Compare & Trip Parameters
    // -------------------------------------------------------------
    const compareUrlNoTrip = base + '/vehicles/compare?compare=v1,v2';
    for (const size of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
      await p.setViewportSize(size);
      await p.goto(compareUrlNoTrip);
      await p.locator('.compare-column h2').last().waitFor();
      await assertCleanScreen(p, `Compare page (no trip) at ${size.width}`);

      await p.getByText('Chưa chọn chuyến', { exact: true }).waitFor();
      const chooseTripCta = p.getByRole('link', { name: 'Chọn chuyến để kiểm tra giá', exact: true });
      check(`Compare page has "Chọn chuyến để kiểm tra giá" CTA at ${size.width}`, await chooseTripCta.isVisible(), true);

      const guidance = p.getByText('Chọn ngày nhận, ngày trả và chi nhánh để so sánh tổng giá chuyến.', { exact: true });
      check(`Compare page has trip selection guidance at ${size.width}`, await guidance.isVisible(), true);

      check(`No false "Kiểm tra lại giá & lịch" button when no trip at ${size.width}`, await p.getByRole('button', { name: 'Kiểm tra lại giá & lịch' }).count(), 0);
      const reloadVehiclesBtn = p.getByRole('button', { name: 'Tải lại thông tin xe', exact: true });
      check(`"Tải lại thông tin xe" button exists at ${size.width}`, await reloadVehiclesBtn.isVisible(), true);

      check(`No horizontal overflow on compare at ${size.width}`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await p.screenshot({ path: path.join(out, `browser-compare-no-trip-${size.width}.png`) });

      await chooseTripCta.click();
      await p.getByRole('heading', { name: 'Danh sách xe', exact: true }).waitFor();
      check(`CTA navigates to catalog preserving compare IDs at ${size.width}`, new URL(p.url()).searchParams.get('compare'), 'v1,v2');
      await assertCleanScreen(p, `Catalog navigated from compare at ${size.width}`);
    }

    // Incomplete / Invalid trip on Compare
    await p.setViewportSize({ width: 1440, height: 900 });
    const netBeforePartial = network.length;
    await p.goto(base + '/vehicles/compare?compare=v1,v2&start=2026-11-20T10:00');
    await p.locator('.compare-column h2').last().waitFor();
    await assertCleanScreen(p, 'Compare page (incomplete trip)');

    check('Incomplete trip error notice visible', await p.getByText('Hãy chọn đủ thời gian và điểm nhận/trả hợp lệ để tìm xe.').first().isVisible(), true);
    check('Incomplete trip guidance visible', await p.getByText('Thông số chuyến chưa hợp lệ: hãy chọn đủ ngày nhận, ngày trả và chi nhánh hợp lệ để kiểm tra giá.').isVisible(), true);
    check('No price search called for partial trip', network.slice(netBeforePartial).filter(r => r.path.endsWith('/vehicles/search')).length, 0);
    check('No "Kiểm tra lại giá & lịch" button on partial trip', await p.getByRole('button', { name: 'Kiểm tra lại giá & lịch' }).count(), 0);
    await p.screenshot({ path: path.join(out, 'browser-compare-partial-trip.png') });

    // Valid trip on Compare
    const priceResponsePromise = p.waitForResponse(r => r.url().includes('/vehicles/search'));
    await p.goto(base + '/vehicles/compare?compare=v1,v2&start=2026-10-26&end=2026-10-28&pickupBranchId=dn');
    const priceRes = await priceResponsePromise;
    await p.locator('.compare-column h2').last().waitFor();
    await assertCleanScreen(p, 'Compare page (valid trip)');
    check('Valid trip called pricing search API', priceRes.status() === 200, true);
    check('Valid trip button "Kiểm tra lại giá & lịch" visible', await p.getByRole('button', { name: 'Kiểm tra lại giá & lịch', exact: true }).isVisible(), true);
    await p.screenshot({ path: path.join(out, 'browser-compare-valid-trip.png') });

    // -------------------------------------------------------------
    // 5. NHÓM 3 (UX02b) & NHÓM 5: Vehicle Detail, Gallery & Keyboard
    // -------------------------------------------------------------
    for (const size of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
      await p.setViewportSize(size);
      await p.goto(base + '/vehicles/v3');
      await p.getByRole('heading', { name: 'Hyundai Accent', exact: true }).first().waitFor();
      await assertCleanScreen(p, `Hyundai Accent detail at ${size.width}`);

      const amenityLocator = p.getByText('Chưa có thông tin tiện nghi được cung cấp; vui lòng xác nhận với chi nhánh.', { exact: true });
      await amenityLocator.waitFor();
      const amenityText = await amenityLocator.isVisible();
      check(`Accent detail standardized empty amenity copy at ${size.width}`, amenityText, true);

      const illustrationLabel = await p.locator('.image-credit').getByText('Ảnh minh họa', { exact: true }).isVisible();
      check(`Gallery has "Ảnh minh họa" label at ${size.width}`, illustrationLabel, true);

      const attributionDetails = p.locator('.image-credit details');
      check(`Gallery has expandable details at ${size.width}`, await attributionDetails.count(), 1);
      const summary = attributionDetails.locator('summary');
      check(`Details summary is "Nguồn ảnh và giấy phép" at ${size.width}`, (await summary.textContent()).trim(), 'Nguồn ảnh và giấy phép');

      check(`Details initially closed at ${size.width}`, await attributionDetails.evaluate(e => e.open), false);

      // Keyboard accessibility test: Focus summary, press Enter to open
      await summary.focus();
      check(`Summary is activeElement on focus at ${size.width}`, await summary.evaluate(el => document.activeElement === el), true);
      await p.keyboard.press('Enter');
      check(`Details opened via Enter key at ${size.width}`, await attributionDetails.evaluate(e => e.open), true);
      await p.screenshot({ path: path.join(out, `browser-accent-gallery-keyboard-opened-${size.width}.png`) });

      const wikimediaLink = attributionDetails.locator('a[href*="commons.wikimedia.org"]');
      check(`Attribution contains clickable source link at ${size.width}`, await wikimediaLink.count() > 0, true);
      check(`Attribution link target is _blank at ${size.width}`, await wikimediaLink.first().getAttribute('target'), '_blank');

      // Keyboard accessibility test: Press Enter again to close
      await p.keyboard.press('Enter');
      check(`Details closed via Enter key at ${size.width}`, await attributionDetails.evaluate(e => e.open), false);
      await p.screenshot({ path: path.join(out, `browser-accent-gallery-keyboard-closed-${size.width}.png`) });

      check(`No horizontal overflow on vehicle detail at ${size.width}`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

      // NHÓM 5 (DATA01): Customer reviews section for Accent
      const reviewSection = p.locator('section').filter({ has: p.getByRole('heading', { name: 'Đánh giá của khách hàng', exact: true }) });
      await reviewSection.scrollIntoViewIfNeeded();

      const testReviewCount = await reviewSection.getByText(/Phase 5 browser verification review/).count();
      check(`Accent public reviews has ZERO Phase 5 test reviews at ${size.width}`, testReviewCount, 0);

      const emptyReviewMsg = await reviewSection.getByText('Xe chưa có đánh giá công khai.').isVisible();
      check(`Accent public reviews shows empty notice at ${size.width}`, emptyReviewMsg, true);

      await p.screenshot({ path: path.join(out, `browser-accent-reviews-settled-${size.width}.png`) });
    }

    // Ford Everest detail check
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.goto(base + '/vehicles/52c9b32f-8c37-4cdb-aa19-10be35891dcc');
    await p.getByRole('heading', { name: 'Ford Everest', exact: true }).first().waitFor();
    await assertCleanScreen(p, 'Ford Everest detail');
    check('Ford Everest standardized empty amenity copy', await p.getByText('Chưa có thông tin tiện nghi được cung cấp; vui lòng xác nhận với chi nhánh.', { exact: true }).isVisible(), true);
    await p.screenshot({ path: path.join(out, 'browser-everest-detail.png') });

    // -------------------------------------------------------------
    // 6. REAL 125% BROWSER ZOOM VERIFICATION (via Extension)
    // -------------------------------------------------------------
    console.log('Verifying Real 125% Browser Zoom via Chrome Extension Service Worker...');

    // A. Register at Real 125% Zoom (1440x900 base @ 1.25)
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.goto(base + '/register');
    await p.getByRole('heading', { name: 'Đăng ký tài khoản', exact: true }).waitFor();
    const regZoom = await setRealZoom(1.25);
    check('Register page real zoom factor', regZoom.zoom, 1.25);
    check('Register page real DPR is 1.25', regZoom.dpr, 1.25);
    check('No horizontal overflow on Register at real 125% zoom', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await assertCleanScreen(p, 'Register page at real 125% zoom');
    await p.screenshot({ path: path.join(out, 'browser-real125-register.png') });

    // B. Compare (No Trip) at Real 125% Zoom
    await p.goto(compareUrlNoTrip);
    await p.locator('.compare-column h2').last().waitFor();
    const compZoom = await setRealZoom(1.25);
    check('Compare page real zoom factor', compZoom.zoom, 1.25);
    check('Compare page real DPR is 1.25', compZoom.dpr, 1.25);
    check('No horizontal overflow on Compare at real 125% zoom', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    check('Choose trip CTA visible at real 125% zoom', await p.getByRole('link', { name: 'Chọn chuyến để kiểm tra giá', exact: true }).isVisible(), true);
    await assertCleanScreen(p, 'Compare page at real 125% zoom');
    await p.screenshot({ path: path.join(out, 'browser-real125-compare-no-trip.png') });

    // C. Vehicle Detail (Hyundai Accent) at Real 125% Zoom
    await p.goto(base + '/vehicles/v3');
    await p.getByRole('heading', { name: 'Hyundai Accent', exact: true }).first().waitFor();
    const detailZoom = await setRealZoom(1.25);
    check('Detail page real zoom factor', detailZoom.zoom, 1.25);
    check('Detail page real DPR is 1.25', detailZoom.dpr, 1.25);
    check('No horizontal overflow on Detail at real 125% zoom', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    check('Empty amenities copy visible at real 125% zoom', await p.getByText('Chưa có thông tin tiện nghi được cung cấp; vui lòng xác nhận với chi nhánh.', { exact: true }).isVisible(), true);
    check('Gallery illustration badge visible at real 125% zoom', await p.locator('.image-credit').getByText('Ảnh minh họa', { exact: true }).isVisible(), true);
    await assertCleanScreen(p, 'Hyundai Accent detail at real 125% zoom');
    await p.screenshot({ path: path.join(out, 'browser-real125-accent-detail.png') });

    // D. Rental Guide at Real 125% Zoom
    await p.goto(base + '/rental-guide');
    await p.getByRole('heading', { name: 'Hướng dẫn thuê xe', exact: true }).waitFor();
    const guideZoom = await setRealZoom(1.25);
    check('Rental guide real zoom factor', guideZoom.zoom, 1.25);
    check('Rental guide real DPR is 1.25', guideZoom.dpr, 1.25);
    check('No horizontal overflow on Rental Guide at real 125% zoom', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    check('Step 1 visible at real 125% zoom', await p.getByText('1. Chọn xe và chuyến đi').isVisible(), true);
    await assertCleanScreen(p, 'Rental guide at real 125% zoom');
    await p.screenshot({ path: path.join(out, 'browser-real125-rental-guide.png') });

    // Reset zoom to 1.0
    await setRealZoom(1.0);

    // Final integrity checks
    check('No framework error overlay across entire session', await p.locator('vite-error-overlay').count(), 0);
    check('No unhandled page errors across entire session', errors.length, 0);
    const totalConsoleErrors = consoleLogs.filter(c => c.type === 'error').length;
    check('No console errors across entire session', totalConsoleErrors, 0);

  } finally {
    await ctx.close();
  }

  fs.writeFileSync(path.join(out, 'browser-observations.json'), JSON.stringify({
    totalChecks: observations.length,
    passedChecks: observations.filter(o => o.pass).length,
    errors,
    consoleLogs: consoleLogs.filter(c => c.type === 'error'),
    observations
  }, null, 2));

  console.log(`PASS ${observations.length} desktop browser assertions; 0 errors; real 125% zoom and USER session verified.`);
})().catch(err => {
  console.error('DESKTOP BROWSER VERIFICATION FAILED:', err);
  process.exit(1);
});
