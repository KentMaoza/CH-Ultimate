import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { OperationsGateway } from '../gateway/operations-gateway';

const GatewayContext = createContext<OperationsGateway | null>(null);

export function OperationsProvider({ children, gateway }: { children: ReactNode; gateway: OperationsGateway }) {
  if (!gateway) throw new Error('OperationsGateway is required.');
  return <GatewayContext.Provider value={gateway}>{children}</GatewayContext.Provider>;
}

export function useOperations() {
  const gateway = useContext(GatewayContext);
  if (!gateway) throw new Error('OperationsProvider is missing.');
  const state = useSyncExternalStore(gateway.subscribe, gateway.getSnapshot, gateway.getSnapshot);
  return { state, gateway };
}
