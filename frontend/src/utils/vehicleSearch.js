const keys = ["brand", "q", "status", "category", "seats", "transmission", "sort", "start", "end", "pickupBranchId", "returnBranchId", "budget"];
export function searchParams(source, changes = {}) {
  const result = new URLSearchParams();
  for (const key of keys) {
    const value = Object.hasOwn(changes, key) ? changes[key] : source.get(key);
    if (value !== null && value !== undefined && value !== "") result.set(key, value);
  }
  return result;
}
export function searchSuffix(params) {
  const value = searchParams(params).toString();
  return value ? `?${value}` : "";
}
export function tripSearch(params) {
  const fields = ["start", "end", "pickupBranchId", "returnBranchId"];
  const active = fields.some(key => params.has(key)) || params.has("budget");
  if (!active) return { active: false, path: "", error: "" };
  const invalid = { active: true, path: "", error: "Hãy chọn đủ thời gian và điểm nhận/trả hợp lệ để tìm xe." };
  if (fields.some(key => !params.get(key))) return invalid;
  const dates = [params.get("start"), params.get("end")];
  if (dates.some(value => !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))) return invalid;
  const [start, end] = dates.map(value => new Date(`${value}:00+07:00`));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return invalid;
  if ([start, end].some((value, index) => new Date(value.getTime() + 7 * 3600000).toISOString().slice(0, 16) !== dates[index])) return invalid;
  const budget = params.get("budget");
  if (budget !== null && (!/^\d+$/.test(budget) || !Number.isSafeInteger(Number(budget)))) return invalid;
  const api = new URLSearchParams({ startAt: start.toISOString(), endAt: end.toISOString(), pickupBranchId: params.get("pickupBranchId"), returnBranchId: params.get("returnBranchId") });
  if (budget !== null) api.set("budget", budget);
  return { active: true, path: `/vehicles/search?${api}`, error: "" };
}
