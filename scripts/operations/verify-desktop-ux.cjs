const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require(path.resolve('.runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright'));

const base = process.env.KDRIVE_BASE_URL || 'http://localhost:5173';
const out = path.resolve(process.argv[2] || '.runtime/ux-desktop-improvement-implementation-20261021-102500');
if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });

const observations = [];
const consoleLogs = [];
const errors = [];
const network = [];

function check(name, actual, expected = true) {
  assert.deepEqual(actual, expected, name);
  observations.push({ name, actual, expected, pass: true });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'vi-VN'
    });
    const p = await ctx.newPage();
    p.setDefaultTimeout(15000);

    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => {
      if (['error', 'warning'].includes(m.type())) {
        consoleLogs.push({ type: m.type(), text: m.text() });
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

    // 1. NHÓM 4 (UX03): Desktop Navbar & Rental Guide
    await p.goto(base);
    await p.getByRole('heading', { name: /Mỗi chuyến đi/ }).waitFor();

    const desktopNavGuide = p.locator('header nav a[href="/rental-guide"]');
    check('Desktop header has /rental-guide link', await desktopNavGuide.count(), 1);
    check('Desktop header /rental-guide label is Hướng dẫn thuê xe', (await desktopNavGuide.textContent()).trim(), 'Hướng dẫn thuê xe');

    const guideBox = await desktopNavGuide.boundingBox();
    check('Guide link visible in initial viewport', guideBox.y >= 0 && guideBox.y < 100);

    await desktopNavGuide.click();
    await p.getByRole('heading', { name: 'Hướng dẫn thuê xe', exact: true }).waitFor();
    check('Navigated to /rental-guide', new URL(p.url()).pathname, '/rental-guide');

    const stepCount = await p.locator('ol > li').count();
    check('Rental guide has 7 steps', stepCount, 7);
    const faq = p.locator('summary').filter({ hasText: 'Giá thuê được tính thế nào?' });
    await faq.click();
    check('FAQ expands on click', await faq.evaluate(e => e.parentElement.open), true);
    await p.screenshot({ path: path.join(out, 'browser-guide-desktop-1440.png') });

    // 2. NHÓM 2 (UX02a): Register copy & password hint
    for (const size of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
      await p.setViewportSize(size);
      await p.goto(base + '/register');
      await p.getByRole('heading', { name: 'Đăng ký tài khoản', exact: true }).waitFor();

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

    // Zoom 125% check on register (effective viewport 1152x720)
    await p.setViewportSize({ width: 1152, height: 720 });
    await p.goto(base + '/register');
    await p.getByRole('heading', { name: 'Đăng ký tài khoản', exact: true }).waitFor();
    check('No horizontal overflow on register at 125% zoom', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await p.screenshot({ path: path.join(out, 'browser-register-zoom125.png') });

    // 3. NHÓM 1 (UX01): Vehicle Compare & Trip Parameters
    const compareUrlNoTrip = base + '/vehicles/compare?compare=v1,v2';
    for (const size of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
      await p.setViewportSize(size);
      await p.goto(compareUrlNoTrip);
      await p.locator('.compare-column h2').last().waitFor();

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
    }

    // Incomplete / Invalid trip on Compare
    await p.setViewportSize({ width: 1440, height: 900 });
    const netBeforePartial = network.length;
    await p.goto(base + '/vehicles/compare?compare=v1,v2&start=2026-11-20T10:00');
    await p.locator('.compare-column h2').last().waitFor();

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
    check('Valid trip called pricing search API', priceRes.status() === 200, true);
    check('Valid trip button "Kiểm tra lại giá & lịch" visible', await p.getByRole('button', { name: 'Kiểm tra lại giá & lịch', exact: true }).isVisible(), true);
    await p.screenshot({ path: path.join(out, 'browser-compare-valid-trip.png') });

    // Compare at zoom 125%
    await p.setViewportSize({ width: 1152, height: 720 });
    await p.goto(compareUrlNoTrip);
    await p.locator('.compare-column h2').last().waitFor();
    check('No horizontal overflow on compare at 125% zoom', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await p.screenshot({ path: path.join(out, 'browser-compare-zoom125.png') });

    // 4. NHÓM 3 (UX02b) & NHÓM 4 & NHÓM 5: Vehicle Detail, Gallery, Amenities & Reviews
    for (const size of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
      await p.setViewportSize(size);
      await p.goto(base + '/vehicles/v3');
      await p.getByRole('heading', { name: 'Hyundai Accent', exact: true }).first().waitFor();

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
      await summary.click();
      check(`Details opened on click at ${size.width}`, await attributionDetails.evaluate(e => e.open), true);

      const wikimediaLink = attributionDetails.locator('a[href*="commons.wikimedia.org"]');
      check(`Attribution contains clickable source link at ${size.width}`, await wikimediaLink.count() > 0, true);
      check(`Attribution link target is _blank at ${size.width}`, await wikimediaLink.first().getAttribute('target'), '_blank');

      check(`No horizontal overflow on vehicle detail at ${size.width}`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

      await p.screenshot({ path: path.join(out, `browser-accent-gallery-expanded-${size.width}.png`) });

      // NHÓM 5 (DATA01): Customer reviews section for Accent
      const reviewSection = p.locator('section').filter({ has: p.getByRole('heading', { name: 'Đánh giá của khách hàng', exact: true }) });
      await reviewSection.scrollIntoViewIfNeeded();

      const testReviewCount = await reviewSection.getByText(/Phase 5 browser verification review/).count();
      check(`Accent public reviews has ZERO Phase 5 test reviews at ${size.width}`, testReviewCount, 0);

      const emptyReviewMsg = await reviewSection.getByText('Xe chưa có đánh giá công khai.').isVisible();
      check(`Accent public reviews shows empty notice at ${size.width}`, emptyReviewMsg, true);

      await p.screenshot({ path: path.join(out, `browser-accent-reviews-settled-${size.width}.png`) });
    }

    // Detail at zoom 125%
    await p.setViewportSize({ width: 1152, height: 720 });
    await p.goto(base + '/vehicles/v3');
    await p.getByRole('heading', { name: 'Hyundai Accent', exact: true }).first().waitFor();
    check('No horizontal overflow on detail at 125% zoom', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await p.screenshot({ path: path.join(out, 'browser-accent-zoom125.png') });

    // Ford Everest detail check
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.goto(base + '/vehicles/52c9b32f-8c37-4cdb-aa19-10be35891dcc');
    await p.getByRole('heading', { name: 'Ford Everest', exact: true }).first().waitFor();
    check('Ford Everest standardized empty amenity copy', await p.getByText('Chưa có thông tin tiện nghi được cung cấp; vui lòng xác nhận với chi nhánh.', { exact: true }).isVisible(), true);
    await p.screenshot({ path: path.join(out, 'browser-everest-detail.png') });

    check('No framework error overlay', await p.locator('vite-error-overlay').count(), 0);
    check('No unhandled page errors', errors.length, 0);

  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(out, 'browser-observations.json'), JSON.stringify({
    totalChecks: observations.length,
    passedChecks: observations.filter(o => o.pass).length,
    errors,
    consoleLogs: consoleLogs.filter(c => c.type === 'error'),
    observations
  }, null, 2));

  console.log(`PASS ${observations.length} desktop browser assertions; 0 errors.`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
