import { isRentalDate, searchSuffix, tripErrors } from './vehicleSearch.js';

export function assistantVisible(role, path) {
  return role === 'USER' && (path === '/' || /^\/vehicles(?:\/[^/]+)?\/?$/.test(path) || /^\/user\/(?:profile|bookings(?:\/[^/]+)?)\/?$/.test(path));
}
export function assistantDraft(params = new URLSearchParams()) {
  return { start: isRentalDate(params.get('start')) ? params.get('start') : '', end: isRentalDate(params.get('end')) ? params.get('end') : '', pickupBranchId: params.get('pickupBranchId') || '', returnBranchId: params.get('returnBranchId') || params.get('pickupBranchId') || '', passengers: '4', budget: params.get('budget') || '', transmission: '', amenityIds: [] };
}
export function assistantCriteria(draft, branches, now = Date.now()) {
  const errors = tripErrors({ ...draft, differentReturn: true }, now);
  if (!isRentalDate(draft.start) || !isRentalDate(draft.end)) errors.dates = 'Chọn đủ ngày nhận và ngày trả.';
  if (!branches.some(b => b.id === draft.pickupBranchId && b.status === 'ACTIVE') || !branches.some(b => b.id === draft.returnBranchId && b.status === 'ACTIVE')) errors.branches = 'Chọn chi nhánh đang nhận đơn.';
  const people = Number(draft.passengers), budget = Number(draft.budget);
  if (!/^\d+$/.test(draft.passengers) || people < 2 || people > 9) errors.people = 'Số người từ 2 đến 9, gồm tài xế.';
  if (!/^\d+$/.test(draft.budget) || !Number.isSafeInteger(budget) || budget < 0) errors.budget = 'Nhập tổng ngân sách bằng VND nguyên.';
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  return { pickupDate: draft.start, returnDate: draft.end, pickupBranchId: draft.pickupBranchId, returnBranchId: draft.returnBranchId, passengers: people, budgetVndTotal: budget, preferences: { transmission: draft.transmission || null, amenityIds: [...draft.amenityIds] } };
}
export function assistantSearch(criteria) {
  return searchSuffix(new URLSearchParams({ start: criteria.pickupDate, end: criteria.returnDate, pickupBranchId: criteria.pickupBranchId, returnBranchId: criteria.returnBranchId, budget: String(criteria.budgetVndTotal) }));
}
export function assistantReasons(item, criteria, amenities) {
  const reasons = [`Đủ chỗ cho ${criteria.passengers} người`, 'Trong tổng ngân sách'];
  if (item.reasonCodes.includes('TRANSMISSION_MATCH')) reasons.push('Khớp hộp số ưu tiên');
  for (const amenity of amenities) if (item.reasonCodes.includes(`AMENITY_MATCH:${amenity.id}`)) reasons.push(amenity.name);
  return reasons.join(' · ');
}
