import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

export interface NetworkContextValue {
  isOnline: boolean;
  isChecking: boolean;
}

const NetworkContext = createContext<NetworkContextValue>({
  isOnline: true,
  isChecking: true,
});

function deriveOnlineState(state: NetInfoState): boolean {
  if (state.isConnected === false) return false;
  if (state.isInternetReachable === false) return false;
  return true;
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    let active = true;

    NetInfo.fetch()
      .then((state) => {
        if (!active) return;
        setIsOnline(deriveOnlineState(state));
        setIsChecking(false);
      })
      .catch(() => {
        if (!active) return;
        setIsOnline(true);
        setIsChecking(false);
      });

    const unsubscribe = NetInfo.addEventListener((state) => {
      if (!active) return;
      setIsOnline(deriveOnlineState(state));
      setIsChecking(false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({ isOnline, isChecking }),
    [isOnline, isChecking]
  );

  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  );
}

export function useNetworkStatus(): NetworkContextValue {
  return useContext(NetworkContext);
}
