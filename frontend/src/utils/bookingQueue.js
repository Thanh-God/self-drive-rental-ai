export function vietnamDay(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export const queueDateField = mode => mode === 'handover' ? 'startAt' : mode === 'return' ? 'endAt' : 'createdAt';
export const workStatusLabels = {
  handover: { CONFIRMED: 'Chờ bàn giao', IN_PROGRESS: 'Đã bàn giao · Đang thuê' },
  return: { IN_PROGRESS: 'Chờ nhận trả · Đang thuê', RETURNED: 'Đã nhận xe · Chờ hoàn tất', COMPLETED: 'Đã hoàn tất' },
};
export const bookingSortLabels = {
  createdAt_desc: 'Mới tạo trước',
  createdAt_asc: 'Cũ tạo trước',
  startAt_asc: 'Ngày nhận gần trước',
};

export function visibleBookings(bookings, { query = '', status = '', queue = 'all', date = '', mode = 'all', now = Date.now(), sort = 'createdAt_desc' } = {}) {
  const today = vietnamDay(now), field = queueDateField(mode);
  const selectedDay = /^\d{4}-\d{2}-\d{2}$/.test(date) && vietnamDay(date + 'T00:00:00+07:00') === date ? date : '';
  return (Array.isArray(bookings) ? bookings : []).filter(booking =>
    (!workStatusLabels[mode] || Object.hasOwn(workStatusLabels[mode], booking.status)) &&
    (!status || booking.status === status) &&
    (queue !== 'today' || vietnamDay(booking[field]) === today) &&
    (queue !== 'date' || (selectedDay && vietnamDay(booking[field]) === selectedDay)) &&
    `${booking.id} ${booking.vehicleName} ${booking.customerName || ''}`.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi'))
  ).sort((a, b) => {
    if (sort === 'createdAt_asc') {
      const first = Date.parse(a.createdAt), second = Date.parse(b.createdAt);
      const firstValid = Number.isFinite(first), secondValid = Number.isFinite(second);
      if (!firstValid && !secondValid) return String(a.id).localeCompare(String(b.id));
      if (!firstValid) return 1;
      if (!secondValid) return -1;
      return first - second || String(a.id).localeCompare(String(b.id));
    }
    if (sort === 'startAt_asc') {
      const first = Date.parse(a.startAt), second = Date.parse(b.startAt);
      const firstValid = Number.isFinite(first), secondValid = Number.isFinite(second);
      if (!firstValid && !secondValid) return String(a.id).localeCompare(String(b.id));
      if (!firstValid) return 1;
      if (!secondValid) return -1;
      return first - second || String(a.id).localeCompare(String(b.id));
    }
    // Default: createdAt_desc
    const first = Date.parse(a.createdAt), second = Date.parse(b.createdAt);
    const firstValid = Number.isFinite(first), secondValid = Number.isFinite(second);
    if (!firstValid && !secondValid) return String(a.id).localeCompare(String(b.id));
    if (!firstValid) return 1;
    if (!secondValid) return -1;
    return second - first || String(a.id).localeCompare(String(b.id));
  });
}

