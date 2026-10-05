import axios from "axios";
import { clearSession, getStoredToken } from "../utils/storage";
import { shouldClearUnauthorizedSession } from "../utils/requestGeneration";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080/api/v1";

const AUTH_SKIP_PATHS = ["/auth/login", "/auth/register"];

let onUnauthorized = null;
let onForbidden = null;
let onServerError = null;

export function setAuthInterceptors({
  unauthorized,
  forbidden,
  serverError,
} = {}) {
  onUnauthorized = unauthorized ?? null;
  onForbidden = forbidden ?? null;
  onServerError = serverError ?? null;
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

apiClient.interceptors.request.use((config) => {
  const isAuthCall = AUTH_SKIP_PATHS.some((path) =>
    config.url?.includes(path),
  );
  if (!isAuthCall) {
    const token = getStoredToken();
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const requestUrl = error.config?.url ?? "";
    const isAuthCall = AUTH_SKIP_PATHS.some((path) =>
      requestUrl.includes(path),
    );
    const authorization =
      error.config?.headers?.Authorization ??
      error.config?.headers?.authorization;
    const requestToken =
      typeof authorization === "string"
        ? authorization.replace(/^Bearer\s+/i, "")
        : null;

    if (
      status === 401 &&
      !isAuthCall &&
      shouldClearUnauthorizedSession(requestToken, getStoredToken())
    ) {
      clearSession();
      onUnauthorized?.();
    } else if (status === 403) {
      onForbidden?.(error);
    } else if (status >= 500) {
      onServerError?.(error);
    }

    return Promise.reject(error);
  },
);

export default apiClient;
