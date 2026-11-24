import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import type { StoredMobileCredentials } from '@/auth/secure-store';
import {
  type SessionManager,
  type SessionSnapshot,
} from '@/auth/session-manager';
import { mobileSessionManager } from '@/auth/runtime';
import { useNetworkStatus } from '@/providers/NetworkProvider';

export interface AuthContextValue {
  status: SessionSnapshot['status'];
  credentials: StoredMobileCredentials | null;
  user: StoredMobileCredentials['user'] | null;
  device: StoredMobileCredentials['device'] | null;
  notice: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<StoredMobileCredentials>;
  logout: () => Promise<void>;
  clearNotice: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: React.ReactNode;
  sessionManager?: SessionManager;
}

export function AuthProvider({
  children,
  sessionManager = mobileSessionManager,
}: AuthProviderProps) {
  const { isOnline } = useNetworkStatus();
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;

  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() =>
    sessionManager.getSnapshot()
  );

  useEffect(() => {
    const unsubscribe = sessionManager.subscribe((next) => {
      setSnapshot(next);
    });

    if (sessionManager.getSnapshot().status === 'hydrating') {
      void sessionManager.hydrate();
    } else {
      setSnapshot(sessionManager.getSnapshot());
    }

    return unsubscribe;
  }, [sessionManager]);

  // Foreground resume triggers single-flight proactive refresh only when authenticated & online
  useEffect(() => {
    let lastState: string = AppState.currentState ?? 'active';
    const subscription = AppState.addEventListener('change', (nextState) => {
      const resumedFromBackground =
        (lastState === 'background' || lastState === 'inactive') &&
        nextState === 'active';
      lastState = nextState;

      if (resumedFromBackground && isOnlineRef.current) {
        void sessionManager.onAppForeground();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [sessionManager]);

  const login = useCallback(
    (email: string, password: string) => sessionManager.login(email, password),
    [sessionManager]
  );

  const logout = useCallback(
    () => sessionManager.logout(),
    [sessionManager]
  );

  const clearNotice = useCallback(
    () => sessionManager.clearNotice(),
    [sessionManager]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status: snapshot.status,
      credentials: snapshot.credentials,
      user: snapshot.credentials?.user ?? null,
      device: snapshot.credentials?.device ?? null,
      notice: snapshot.notice,
      isAuthenticated:
        snapshot.status === 'authenticated' && snapshot.credentials !== null,
      login,
      logout,
      clearNotice,
    }),
    [snapshot, login, logout, clearNotice]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }
  return ctx;
}
