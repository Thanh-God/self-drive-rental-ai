import apiClient from "./client";

function normalizeAuthPayload(data) {
  const token = data?.token ?? data?.accessToken ?? data?.jwt ?? null;
  const user = data?.user ?? data?.account ?? null;
  return { token, user, raw: data };
}

export async function loginRequest({ email, password }) {
  const { data } = await apiClient.post("/auth/login", { email, password });
  return normalizeAuthPayload(data);
}

export async function registerRequest(payload) {
  const { data } = await apiClient.post("/auth/register", payload);
  return normalizeAuthPayload(data);
}

export async function fetchCurrentUser() {
  const { data } = await apiClient.get("/auth/me");
  return data?.user ?? data;
}

export async function logoutRequest() {
  try {
    await apiClient.post("/auth/logout");
  } catch (error) {
    // An expired token is already invalid. A network/server failure does not
    // prove that all sessions were revoked; let the UI offer a retry.
    if (error.response?.status !== 401) throw error;
  }
}
