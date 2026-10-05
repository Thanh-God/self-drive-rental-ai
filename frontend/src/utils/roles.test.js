import test from "node:test";
import assert from "node:assert/strict";
import { destinationForRole } from "./roles.js";

test("login keeps a requested route only when it belongs to the authenticated role", () => {
  assert.equal(
    destinationForRole("USER", "/user/bookings?status=COMPLETED"),
    "/user/bookings?status=COMPLETED",
  );
  assert.equal(destinationForRole("STAFF", "/staff/queue"), "/staff/queue");
  assert.equal(destinationForRole("ADMIN", "/admin/reviews"), "/admin/reviews");
  assert.equal(destinationForRole("STAFF", "/user/bookings"), "/staff/queue");
  assert.equal(destinationForRole("ADMIN", "/staff/queue"), "/admin");
  assert.equal(destinationForRole("USER", "/staff"), "/user/bookings");
});
