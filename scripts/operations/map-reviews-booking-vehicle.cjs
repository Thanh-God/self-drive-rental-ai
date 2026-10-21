const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const base = process.env.KDRIVE_API_BASE_URL || 'http://127.0.0.1:8080/api/v1';
const out = path.resolve(process.argv[2] || '.runtime/ux-desktop-improvement-fix-20261021-112200');
if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });

async function main() {
  let password = process.env.KDRIVE_ADMIN_PASSWORD;
  if (!password && fs.existsSync('backend/.env.local')) {
    const env = fs.readFileSync('backend/.env.local', 'utf8');
    password = env.match(/^SEED_PASSWORD=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
  }
  assert.ok(password, 'Admin password required');

  const loginRes = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.test', password })
  });
  assert.equal(loginRes.status, 200, 'Admin login failed');
  const { token } = await loginRes.json();
  const headers = { Authorization: 'Bearer ' + token };

  // Fetch admin reviews
  const reviewsRes = await fetch(base + '/admin/reviews', { headers });
  assert.equal(reviewsRes.status, 200);
  const reviews = await reviewsRes.json();

  // Fetch bookings (BookingController is mounted at /bookings)
  const bookingsRes = await fetch(base + '/bookings', { headers });
  assert.equal(bookingsRes.status, 200, `GET /bookings failed: ${bookingsRes.status}`);
  const bookings = await bookingsRes.json();

  // Fetch vehicle v3 details
  const vehicleRes = await fetch(base + '/vehicles/v3');
  assert.equal(vehicleRes.status, 200);
  const vehicleV3 = await vehicleRes.json();

  const mapping = [];

  for (const r of reviews) {
    const bookingId = r.bookingId || r.booking_id;
    const booking = bookings.find(b => b.id === bookingId);
    assert.ok(booking, `Booking not found for review ${r.id}: booking_id=${bookingId}`);
    const vehicleId = booking.vehicleId || booking.vehicle_id;
    assert.equal(vehicleId, 'v3', `Booking ${booking.id} does not belong to vehicle v3 (actual: ${vehicleId})`);

    mapping.push({
      reviewId: r.id,
      reviewRating: r.rating,
      reviewContent: r.content,
      reviewHidden: r.hidden,
      reviewVersion: r.version,
      bookingId: booking.id,
      bookingStatus: booking.status,
      bookingVehicleId: vehicleId,
      vehicleExpectedId: 'v3',
      vehicleName: vehicleV3.model || 'Hyundai Accent',
      verified: true
    });
  }

  assert.equal(mapping.length, 4, 'Must map all 4 moderated reviews');

  fs.writeFileSync(path.join(out, 'review-booking-vehicle-mapping.json'), JSON.stringify({
    timestamp: new Date().toISOString(),
    vehicleId: 'v3',
    vehicleModel: vehicleV3.model,
    reviewsCount: mapping.length,
    allLinkedToV3: true,
    mapping
  }, null, 2));

  console.log('PASS: Successfully verified and mapped all 4 moderated reviews -> bookings -> vehicle v3 (Hyundai Accent).');
}

main().catch(err => {
  console.error('MAPPING FAILED:', err);
  process.exit(1);
});
