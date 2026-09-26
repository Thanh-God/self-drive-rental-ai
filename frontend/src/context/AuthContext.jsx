import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
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

  const logout = useCallback(
    async ({ callApi = true } = {}) => {
      if (DEMO_MODE) {
        selectDemoRole("GUEST");
        return;
      }
      if (callApi && getStoredToken()) {
        await logoutRequest();
      }
      clearSession();
      setToken(null);
      setUser(null);
    },
    [selectDemoRole],
  );

  useEffect(() => {
    if (DEMO_MODE) return undefined;
    let cancelled = false;

    async function hydrate() {
      setSessionError("");
      const storedToken = getStoredToken();
      if (!storedToken) {
        setLoading(false);
        return;
      }
      try {
        const profile = await fetchCurrentUser();
        if (!cancelled && profile) {
          persistSession(storedToken, {
            id: profile.id,
            fullName: profile.fullName,
            email: profile.email,
            role: profile.role,
          });
        }
      } catch (error) {
        if (!cancelled) {
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
        if (!cancelled) setLoading(false);
      }
    }

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [persistSession, logout, retry]);

  const login = useCallback(
    async ({ email, password }) => {
      if (DEMO_MODE)
        throw new Error("Bản demo không nhận mật khẩu. Hãy chọn vai trò mẫu.");
      const { token: nextToken, user: nextUser } = await loginRequest({
        email,
        password,
      });
      if (!nextToken || !nextUser) {
        throw new Error("Phản hồi đăng nhập không hợp lệ.");
      }
      persistSession(nextToken, {
        id: nextUser.id,
        fullName: nextUser.fullName,
        email: nextUser.email,
        role: nextUser.role,
      });
      return nextUser;
    },
    [persistSession],
  );

  const register = useCallback(
    async (payload) => {
      if (DEMO_MODE)
        throw new Error(
          "Bản demo không tạo tài khoản thật. Hãy dùng vai trò User mẫu.",
        );
      const result = await registerRequest(payload);
      if (result.token && result.user) {
        persistSession(result.token, {
          id: result.user.id,
          fullName: result.user.fullName,
          email: result.user.email,
          role: result.user.role,
        });
      }
      return result;
    },
    [persistSession],
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
    }),
    [
      user,
      token,
      loading,
      login,
      register,
      logout,
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
