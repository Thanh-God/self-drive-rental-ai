export const ROLES = {
  USER: "USER",
  STAFF: "STAFF",
  ADMIN: "ADMIN",
};

export function homePathForRole(role) {
  if (role === ROLES.ADMIN) return "/admin";
  if (role === ROLES.STAFF) return "/staff/queue";
  if (role === ROLES.USER) return "/";
  return "/";
}

export function destinationForRole(role, requestedPath) {
  if (role === ROLES.USER && isSafeUserDestination(requestedPath)) {
    return requestedPath;
  }

  const roleRoot = {
    [ROLES.STAFF]: "/staff",
    [ROLES.ADMIN]: "/admin",
  }[role];
  return roleRoot &&
    (requestedPath === roleRoot || requestedPath?.startsWith(`${roleRoot}/`))
    ? requestedPath
    : homePathForRole(role);
}

function isSafeUserDestination(requestedPath) {
  if (
    typeof requestedPath !== "string" ||
    !requestedPath.startsWith("/") ||
    requestedPath.startsWith("//") ||
    requestedPath.includes("\\") ||
    [...requestedPath].some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    })
  ) {
    return false;
  }

  try {
    const destination = new globalThis.URL(
      requestedPath,
      "https://kdrive.invalid",
    );
    return (
      destination.origin === "https://kdrive.invalid" &&
      (destination.pathname === "/user" ||
        destination.pathname.startsWith("/user/"))
    );
  } catch {
    return false;
  }
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
