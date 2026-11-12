// L8 (12/11/2026): contracts issued with terms contract-2026-11-12-v2 take effect when the customer presses "Đồng ý";
// the backend refuses the handover until then. Older contracts do not need it.
export const CONTRACT_ACCEPTANCE_VERSION = "contract-2026-11-12-v2";

/** Reads GET /bookings/{id}/contract (a list with at most one row). */
export function contractAcceptance(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { issued: false, required: false, acceptedAt: null };
  return { issued: true, required: row.terms_version === CONTRACT_ACCEPTANCE_VERSION, acceptedAt: row.accepted_at ?? null };
}

export function handoverBlockedByContract(acceptance) {
  return Boolean(acceptance?.required && !acceptance.acceptedAt);
}
