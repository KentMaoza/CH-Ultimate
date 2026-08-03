import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { OperationsGateway } from '../gateway/operations-gateway';

const GatewayContext = createContext<OperationsGateway | null>(null);

export function OperationsProvider({ children, gateway }: { children: ReactNode; gateway: OperationsGateway }) {
  if (!gateway) throw new Error('OperationsGateway is required.');
  return <GatewayContext.Provider value={gateway}>{children}</GatewayContext.Provider>;
}

export function useOperations() {
  const gateway = useContext(GatewayContext);
  if (!gateway) throw new Error('OperationsProvider is missing.');
  const [state, setState] = useState(gateway.getSnapshot);
  useEffect(() => {
    setState(gateway.getSnapshot());
    return gateway.subscribe(() => setState(gateway.getSnapshot()));
  }, [gateway]);
  return { state, gateway };
}
