import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import {
  fetchCurrentUser,
  loginRequest,
  logoutRequest,
  registerRequest,
} from "../api/auth";
import { DEMO_MODE } from "../demo/config";
import { demoActors } from "../demo/seed";
import {
  clearSession,
  getStoredToken,
  setStoredToken,
  setStoredUser,
} from "../utils/storage";
import { createRequestGeneration } from "../utils/requestGeneration";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() =>
    DEMO_MODE ? null : getStoredToken(),
  );
  const [user, setUser] = useState(() => {
    if (!DEMO_MODE) return null;
    try {
      return demoActors[sessionStorage.getItem("kdrive.demo.role")] || null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(
    () => !DEMO_MODE && Boolean(getStoredToken()),
  );
  const [sessionError, setSessionError] = useState("");
  const [retry, setRetry] = useState(0);
  const [sessionGeneration] = useState(createRequestGeneration);
  const pendingLogout = useRef(null);
  const selectDemoRole = useCallback((role) => {
    if (!DEMO_MODE) return;
    setUser(demoActors[role] || null);
    try {
      sessionStorage.setItem("kdrive.demo.role", role);
    } catch {
      /* In-memory preview remains usable. */
    }
  }, []);

  const persistSession = useCallback((nextToken, nextUser) => {
    setStoredToken(nextToken);
    setStoredUser(nextUser);
    setToken(nextToken);
    setUser(nextUser);
  }, []);
  const refreshUser = useCallback((nextUser) => {
    const normalizedUser = {
      id: nextUser.id,
      fullName: nextUser.fullName,
      email: nextUser.email,
      role: nextUser.role,
    };
    setStoredUser(normalizedUser);
    setUser(normalizedUser);
  }, []);

  const logout = useCallback(
    async ({ callApi = true } = {}) => {
      if (DEMO_MODE) {
        selectDemoRole("GUEST");
        return;
      }
      const generation = sessionGeneration.begin();
      const tokenToRevoke = getStoredToken();
      if (callApi && tokenToRevoke) {
        const request = logoutRequest(tokenToRevoke);
        pendingLogout.current = request;
        try {
          await request;
        } catch (error) {
          if (sessionGeneration.isCurrent(generation)) {
            setLoading(false);
          }
          throw error;
        } finally {
          if (pendingLogout.current === request) pendingLogout.current = null;
        }
      }
      if (!sessionGeneration.isCurrent(generation)) return;
      clearSession();
      setToken(null);
      setUser(null);
      setSessionError("");
      setLoading(false);
    },
    [selectDemoRole, sessionGeneration],
  );

  useEffect(() => {
    if (DEMO_MODE) return undefined;
    let cancelled = false;
    const generation = sessionGeneration.begin();

    async function hydrate() {
      setSessionError("");
      const storedToken = getStoredToken();
      if (!storedToken) {
        setLoading(false);
        return;
      }
      try {
        const profile = await fetchCurrentUser();
        if (
          !cancelled &&
          sessionGeneration.isCurrent(generation) &&
          getStoredToken() === storedToken &&
          profile
        ) {
          persistSession(storedToken, {
            id: profile.id,
            fullName: profile.fullName,
            email: profile.email,
            role: profile.role,
          });
        }
      } catch (error) {
        if (
          !cancelled &&
          sessionGeneration.isCurrent(generation) &&
          getStoredToken() === storedToken
        ) {
          if ([401, 403].includes(error.response?.status))
            await logout({ callApi: false });
          else {
            setUser(null);
            setSessionError(
              "Không thể kiểm tra phiên đăng nhập. Vui lòng thử lại khi kết nối ổn định.",
            );
          }
        }
      } finally {
        if (
          !cancelled &&
          sessionGeneration.isCurrent(generation)
        ) {
          setLoading(false);
        }
      }
    }

    hydrate();
    return () => {
      cancelled = true;
      sessionGeneration.invalidate(generation);
    };
  }, [persistSession, logout, retry, sessionGeneration]);

  const login = useCallback(
    async ({ email, password }) => {
      if (DEMO_MODE)
        throw new Error("Bản demo không nhận mật khẩu. Hãy chọn vai trò mẫu.");
      const generation = sessionGeneration.begin();
      setLoading(true);
      setSessionError("");
      try {
        if (pendingLogout.current) await pendingLogout.current;
        if (!sessionGeneration.isCurrent(generation)) {
          throw new Error("Yêu cầu đăng nhập đã bị thay thế.");
        }
        const { token: nextToken, user: nextUser } = await loginRequest({
          email,
          password,
        });
        if (!nextToken || !nextUser) {
          throw new Error("Phản hồi đăng nhập không hợp lệ.");
        }
        if (!sessionGeneration.isCurrent(generation)) {
          throw new Error("Yêu cầu đăng nhập đã bị thay thế.");
        }
        persistSession(nextToken, {
          id: nextUser.id,
          fullName: nextUser.fullName,
          email: nextUser.email,
          role: nextUser.role,
        });
        return nextUser;
      } finally {
        if (sessionGeneration.isCurrent(generation)) {
          setLoading(false);
        }
      }
    },
    [persistSession, sessionGeneration],
  );

  const register = useCallback(
    async (payload) => {
      if (DEMO_MODE)
        throw new Error(
          "Bản demo không tạo tài khoản thật. Hãy dùng vai trò User mẫu.",
        );
      const generation = sessionGeneration.begin();
      setLoading(true);
      setSessionError("");
      try {
        if (pendingLogout.current) await pendingLogout.current;
        if (!sessionGeneration.isCurrent(generation)) {
          throw new Error("Yêu cầu đăng ký đã bị thay thế.");
        }
        const result = await registerRequest(payload);
        if (!sessionGeneration.isCurrent(generation)) {
          throw new Error("Yêu cầu đăng ký đã bị thay thế.");
        }
        if (result.token && result.user) {
          persistSession(result.token, {
            id: result.user.id,
            fullName: result.user.fullName,
            email: result.user.email,
            role: result.user.role,
          });
        }
        return result;
      } finally {
        if (sessionGeneration.isCurrent(generation)) {
          setLoading(false);
        }
      }
    },
    [persistSession, sessionGeneration],
  );

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      isAuthenticated: DEMO_MODE ? Boolean(user) : Boolean(token && user),
      selectDemoRole,
      sessionError,
      retrySession: () => {
        setLoading(true);
        setRetry((value) => value + 1);
      },
      login,
      register,
      logout,
      refreshUser,
    }),
    [
      user,
      token,
      loading,
      login,
      register,
      logout,
      refreshUser,
      selectDemoRole,
      sessionError,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth phải được dùng trong AuthProvider.");
  }
  return context;
}

export default AuthContext;
