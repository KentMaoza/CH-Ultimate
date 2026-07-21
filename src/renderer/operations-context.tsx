import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { MockOperationsGateway, type OperationsGateway } from '../gateway/operations-gateway';

const GatewayContext = createContext<OperationsGateway | null>(null);

export function OperationsProvider({ children, gateway }: { children: ReactNode; gateway?: OperationsGateway }) {
  const value = useMemo(() => gateway ?? new MockOperationsGateway(), [gateway]);
  return <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>;
}

export function useOperations() {
  const gateway = useContext(GatewayContext);
  if (!gateway) throw new Error('OperationsProvider is missing.');
  const state = useSyncExternalStore(gateway.subscribe, gateway.getSnapshot, gateway.getSnapshot);
  return { state, gateway };
}

