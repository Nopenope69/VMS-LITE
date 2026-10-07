import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { configureApi } from '../api/client.js';

export type UserRole = 'ADMIN' | 'OPERATOR' | 'VIEWER';

export type CameraPermissionFlag = 'canViewLive' | 'canViewPlayback' | 'canControlPtz' | 'canExportClips';

export interface CameraPermissionDto {
  cameraId: string;
  canViewLive: boolean;
  canViewPlayback: boolean;
  canControlPtz: boolean;
  canExportClips: boolean;
}

export interface User {
  id: string;
  username: string;
  role: UserRole;
  cameraPermissions?: CameraPermissionDto[];
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  role: UserRole | null;
  isAdmin: boolean;
  isOperator: boolean;
  isViewer: boolean;
  isLoading: boolean;
  /** Licensed capabilities (e.g. 'extended.ptz'), from /api/auth/me */
  capabilities: string[];
  /** The user's effective right on a camera, as reported by /api/auth/me for every role */
  can: (cameraId: string, flag: CameraPermissionFlag) => boolean;
  /** Whether the user may control PTZ on this camera (licensed and granted) */
  canControlPtz: (cameraId: string) => boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  /**
   * Call when a request made with `failedToken` got 401. Logs out only if that token is
   * still the current one: after a password change, in-flight requests with the old
   * (revoked) token must not wipe the new session.
   */
  handleUnauthorized: (failedToken: string | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('vms_token'));
  const [user, setUser] = useState<User | null>(() => {
    const cachedUser = localStorage.getItem('vms_user');
    if (cachedUser) {
      try {
        return JSON.parse(cachedUser);
      } catch {
        return null;
      }
    }
    return null;
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [capabilities, setCapabilities] = useState<string[]>([]);

  const verifySession = useCallback(async () => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setCapabilities(data.capabilities || []);
        localStorage.setItem('vms_user', JSON.stringify(data.user));
      } else if (localStorage.getItem('vms_token') === token) {
        // Token expired or revoked, and not already replaced by a newer login
        setToken(null);
        setUser(null);
        localStorage.removeItem('vms_token');
        localStorage.removeItem('vms_user');
      }
    } catch (err) {
      console.warn('[AuthContext] Session verification error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    verifySession();
  }, [verifySession]);

  // Grants can change while the app is open; pick them up when the user comes back
  useEffect(() => {
    if (!token) return;
    window.addEventListener('focus', verifySession);
    return () => window.removeEventListener('focus', verifySession);
  }, [token, verifySession]);

  const login = useCallback((newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('vms_token', newToken);
    localStorage.setItem('vms_user', JSON.stringify(newUser));
  }, []);

  const logout = useCallback(() => {
    // Clears the HttpOnly media cookie used for video playback
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setToken(null);
    setUser(null);
    localStorage.removeItem('vms_token');
    localStorage.removeItem('vms_user');
  }, []);

  const handleUnauthorized = useCallback(
    (failedToken: string | null) => {
      if (!failedToken || localStorage.getItem('vms_token') === failedToken) {
        logout();
      }
    },
    [logout]
  );

  // Every API call (apiFetch) uses this session's token and reports 401s here
  const tokenRef = useRef(token);
  tokenRef.current = token;
  useEffect(() => {
    configureApi({ getToken: () => tokenRef.current, onUnauthorized: handleUnauthorized });
  }, [handleUnauthorized]);

  const role = user?.role ?? null;
  const can = useCallback(
    (cameraId: string, flag: CameraPermissionFlag) =>
      Boolean(user?.cameraPermissions?.some((p) => p.cameraId === cameraId && p[flag])),
    [user]
  );
  const canControlPtz = useCallback(
    (cameraId: string) => capabilities.includes('extended.ptz') && can(cameraId, 'canControlPtz'),
    [capabilities, can]
  );
  const isAdmin = role === 'ADMIN';
  const isOperator = role === 'OPERATOR';
  const isViewer = role === 'VIEWER';

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        role,
        isAdmin,
        isOperator,
        isViewer,
        isLoading,
        capabilities,
        can,
        canControlPtz,
        login,
        logout,
        handleUnauthorized,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    // Return safe default for tests or decoupled rendering
    return {
      user: null,
      token: null,
      role: null,
      isAdmin: false,
      isOperator: false,
      isViewer: false,
      isLoading: false,
      capabilities: [],
      can: () => false,
      canControlPtz: () => false,
      login: () => {},
      logout: () => {},
      handleUnauthorized: () => {},
    };
  }
  return context;
};
