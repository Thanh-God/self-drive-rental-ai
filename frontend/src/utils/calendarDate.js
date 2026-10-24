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
  const localDate = new Date(`${datePart}T${timePart}`);
  if (Number.isNaN(localDate.getTime())) return null;
  return new Date(localDate.getTime() - VIETNAM_OFFSET).toISOString();
}
