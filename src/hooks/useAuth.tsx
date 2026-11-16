import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  apiClient,
  clearStoredTokens,
  getStoredAccessToken,
  getStoredRefreshToken,
  setStoredTokens,
} from '../api/client';
import type { AuthResponse, RoleName, UserProfile } from '../types/api';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, fullName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  hasRole: (...roles: RoleName[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refreshProfile = useCallback(async () => {
    const token = getStoredAccessToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await apiClient.get<UserProfile>('/users/me');
      setUser(res.data);
    } catch {
      clearStoredTokens();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiClient.post<AuthResponse>('/auth/login', { email, password });
    setStoredTokens(res.data.accessToken, res.data.refreshToken);
    const me = await apiClient.get<UserProfile>('/users/me');
    setUser(me.data);
  }, []);

  const register = useCallback(async (email: string, fullName: string, password: string) => {
    const res = await apiClient.post<AuthResponse>('/auth/register', {
      email,
      fullName,
      password,
    });
    setStoredTokens(res.data.accessToken, res.data.refreshToken);
    const me = await apiClient.get<UserProfile>('/users/me');
    setUser(me.data);
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = getStoredRefreshToken();
    try {
      await apiClient.post('/auth/logout', { refreshToken });
    } catch {
      // Ignore network errors during logout cleanup
    } finally {
      clearStoredTokens();
      setUser(null);
    }
  }, []);

  const hasRole = useCallback(
    (...roles: RoleName[]) => {
      if (!user) return false;
      return user.roles.some((r) => roles.includes(r));
    },
    [user]
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshProfile, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
