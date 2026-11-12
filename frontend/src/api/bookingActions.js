import { vietnamDay } from '../utils/bookingQueue.js';
export function getBookingActions(
  booking,
  { role, assignedBranchIds = new Set(), assignmentsReady = true, now },
) {
  if (!booking) return [];

  const status = booking.status;
  const startAt = new Date(booking.startAt).getTime();

  if (role === "STAFF") {
    if (!assignmentsReady) return [];

    const assignedPickup = assignedBranchIds.has(booking.pickupBranchId);
    const assignedReturn = assignedBranchIds.has(booking.returnBranchId);

    if (status === "PENDING" && assignedPickup) {
      return booking.deposit?.required ? ["REJECTED", "CANCELLED"] : ["CONFIRMED", "REJECTED", "CANCELLED"];
    }
    if (status === "CONFIRMED" && assignedPickup && now < new Date(booking.endAt).getTime()) {
      const canHandOver = now >= startAt
        && (booking.policyVersion !== 'calendar-2026-10-17' || vietnamDay(now) === vietnamDay(booking.startAt));
      // L6/Q6: the pickup branch may cancel before the pickup day too (e.g. the car cannot be delivered).
      return canHandOver ? ["IN_PROGRESS", "CANCELLED"] : ["CANCELLED"];
    }
    if (status === "IN_PROGRESS" && assignedReturn) {
      return ["RETURNED"];
    }
    if (status === "RETURNED" && assignedReturn) {
      if (booking.returnSettlement ? booking.returnSettlement.outstandingAmount > 0 : booking.returnAssessment?.collectionStatus === 'UNPAID' && booking.returnAssessment.amountVnd > 0) return [];
      return ["COMPLETED"];
    }
    return [];
  }

  if (role === "ADMIN") {
    return ["PENDING", "CONFIRMED"].includes(status) ? ["CANCELLED"] : [];
  }

  if (
    role === "USER" &&
    ["PENDING", "CONFIRMED"].includes(status) &&
    startAt - now >= 86400000
  ) {
    return ["CANCELLED"];
  }

  return [];
}
