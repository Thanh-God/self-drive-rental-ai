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
      return ["CONFIRMED", "REJECTED", "CANCELLED"];
    }
    if (
      status === "CONFIRMED" &&
      assignedPickup &&
      now >= startAt &&
      now < new Date(booking.endAt).getTime()
    ) {
      return ["IN_PROGRESS", "CANCELLED"];
    }
    if (status === "IN_PROGRESS" && assignedReturn) {
      return ["RETURNED"];
    }
    if (status === "RETURNED" && assignedReturn) {
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
