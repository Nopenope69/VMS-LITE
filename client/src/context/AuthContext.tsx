import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type UserRole = 'ADMIN' | 'OPERATOR' | 'VIEWER';

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
  login: (token: string, user: User) => void;
  logout: () => void;
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

  useEffect(() => {
    async function verifySession() {
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
          localStorage.setItem('vms_user', JSON.stringify(data.user));
        } else {
          // Token expired or invalid
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
    }

    verifySession();
  }, [token]);

  const login = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('vms_token', newToken);
    localStorage.setItem('vms_user', JSON.stringify(newUser));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('vms_token');
    localStorage.removeItem('vms_user');
  };

  const role = user?.role ?? null;
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
        login,
        logout,
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
      login: () => {},
      logout: () => {},
    };
  }
  return context;
};
