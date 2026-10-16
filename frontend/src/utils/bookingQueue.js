export function vietnamDay(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export const queueDateField = mode => mode === 'handover' ? 'startAt' : mode === 'return' ? 'endAt' : 'createdAt';
export function visibleBookings(bookings, { query = '', status = '', queue = 'all', mode = 'all', now = Date.now() } = {}) {
  const today = vietnamDay(now), field = queueDateField(mode);
  return (Array.isArray(bookings) ? bookings : []).filter(booking =>
    (!status || booking.status === status) &&
    (queue !== 'today' || vietnamDay(booking[field]) === today) &&
    `${booking.id} ${booking.vehicleName} ${booking.customerName || ''}`.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi'))
  ).sort((a, b) => {
    const first = Date.parse(a.createdAt), second = Date.parse(b.createdAt);
    if (!Number.isFinite(first)) return Number.isFinite(second) ? 1 : 0;
    if (!Number.isFinite(second)) return -1;
    return second - first || String(a.id).localeCompare(String(b.id));
  });
}
