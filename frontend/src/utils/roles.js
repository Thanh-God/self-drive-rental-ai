export const ROLES = {
  USER: "USER",
  STAFF: "STAFF",
  ADMIN: "ADMIN",
};

export function homePathForRole(role) {
  if (role === ROLES.ADMIN) return "/admin";
  if (role === ROLES.STAFF) return "/staff/queue";
  if (role === ROLES.USER) return "/user/bookings";
  return "/";
}

export function destinationForRole(role, requestedPath) {
  const roleRoot = {
    [ROLES.USER]: "/user",
    [ROLES.STAFF]: "/staff",
    [ROLES.ADMIN]: "/admin",
  }[role];
  return roleRoot &&
    (requestedPath === roleRoot || requestedPath?.startsWith(`${roleRoot}/`))
    ? requestedPath
    : homePathForRole(role);
}

export function getErrorMessage(
  error,
  fallback = "Đã xảy ra lỗi. Vui lòng thử lại.",
) {
  const data = error?.response?.data;
  if (typeof data === "string" && data.trim()) return data;
  if (data?.message) return data.message;
  if (data?.error) return data.error;
  if (error?.message) return error.message;
  return fallback;
}
