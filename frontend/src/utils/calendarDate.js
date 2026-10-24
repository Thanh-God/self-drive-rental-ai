export function displayCalendarDate(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : "";
}
export function parseCalendarDate(text) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return "";
  const iso = text.split("/").reverse().join("-");
  const date = new Date(iso + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : "";
}

export function toVietnamInstant(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value ?? '')) return null;
  const date=new Date(`${value}+07:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
