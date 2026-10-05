import assert from "node:assert/strict";
import test from "node:test";
import { getBookingActions } from "./bookingActions.js";

const now = Date.parse("2026-10-04T10:00:00Z");
const booking = {
  status: "PENDING",
  startAt: "2026-10-05T10:00:00Z",
  endAt: "2026-10-06T10:00:00Z",
  pickupBranchId: "branch-pickup",
  returnBranchId: "branch-return",
};

test("Staff actions require API-backed assignment to the operational branch", () => {
  assert.deepEqual(
    getBookingActions(booking, {
      role: "STAFF",
      assignedBranchIds: new Set(["branch-pickup"]),
      now,
    }),
    ["CONFIRMED", "REJECTED", "CANCELLED"],
  );
  assert.deepEqual(
    getBookingActions(booking, {
      role: "STAFF",
      assignedBranchIds: new Set(["branch-unrelated"]),
      now,
    }),
    [],
  );
  assert.deepEqual(
    getBookingActions(booking, {
      role: "STAFF",
      assignedBranchIds: new Set(["branch-pickup"]),
      assignmentsReady: false,
      now,
    }),
    [],
  );
});

test("handover and return permissions use pickup and return assignments separately", () => {
  assert.deepEqual(
    getBookingActions(
      { ...booking, status: "IN_PROGRESS" },
      {
        role: "STAFF",
        assignedBranchIds: new Set(["branch-pickup"]),
        now,
      },
    ),
    [],
  );
  assert.deepEqual(
    getBookingActions(
      { ...booking, status: "IN_PROGRESS" },
      {
        role: "STAFF",
        assignedBranchIds: new Set(["branch-return"]),
        now,
      },
    ),
    ["RETURNED"],
  );
  assert.deepEqual(
    getBookingActions(
      { ...booking, status: "RETURNED" },
      {
        role: "STAFF",
        assignedBranchIds: new Set(["branch-return"]),
        now,
      },
    ),
    ["COMPLETED"],
  );
});

test("Admin never receives Staff handover or return actions", () => {
  assert.deepEqual(
    getBookingActions(booking, {
      role: "ADMIN",
      assignedBranchIds: new Set(["branch-pickup", "branch-return"]),
      now,
    }),
    ["CANCELLED"],
  );
  assert.deepEqual(
    getBookingActions(
      { ...booking, status: "IN_PROGRESS" },
      {
        role: "ADMIN",
        assignedBranchIds: new Set(["branch-pickup", "branch-return"]),
        now,
      },
    ),
    [],
  );
});
