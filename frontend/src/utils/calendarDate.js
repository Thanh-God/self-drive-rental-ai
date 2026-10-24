export function displayCalendarDate(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : "";
}
export function parseCalendarDate(text) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return "";
  const iso = text.split("/").reverse().join("-");
  const date = new Date(iso + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : "";
}

const VIETNAM_OFFSET = 7 * 60 * 60 * 1000;
export function toVietnamInstant(datetimeLocal) {
  if (!datetimeLocal) return null;
  const [datePart, timePart] = datetimeLocal.split("T");
  if (!datePart || !timePart) return null;
  // Parse as Vietnam time (UTC+7) explicitly
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - VIETNAM_OFFSET;
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
