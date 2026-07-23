import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface RevenueAccess {
  configured: boolean;
  unlocked: boolean;
  configurePassword(currentPassword: string, nextPassword: string): boolean;
  unlock(candidate: string): boolean;
}

const RevenueAccessContext = createContext<RevenueAccess | null>(null);

export function RevenueAccessProvider({ children }: { children: ReactNode }) {
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const value = useMemo<RevenueAccess>(() => ({
    configured: password !== '',
    unlocked,
    configurePassword(currentPassword, nextPassword) {
      if (!nextPassword.trim() || (password !== '' && currentPassword !== password)) return false;
      setPassword(nextPassword);
      setUnlocked(false);
      return true;
    },
    unlock(candidate) {
      const accepted = password !== '' && candidate === password;
      if (accepted) setUnlocked(true);
      return accepted;
    },
  }), [password, unlocked]);

  return <RevenueAccessContext.Provider value={value}>{children}</RevenueAccessContext.Provider>;
}

export function useRevenueAccess() {
  const access = useContext(RevenueAccessContext);
  if (!access) throw new Error('RevenueAccessProvider is missing.');
  return access;
}
