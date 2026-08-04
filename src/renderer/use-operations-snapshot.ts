import { useEffect, useState } from 'react';

import type { OperationsGateway } from '../gateway/operations-gateway';

export function useOperationsSnapshot(gateway: OperationsGateway) {
  const [snapshot, setSnapshot] = useState(() => gateway.getSnapshot());

  useEffect(() => {
    const publish = () => setSnapshot(gateway.getSnapshot());
    publish();
    return gateway.subscribe(publish);
  }, [gateway]);

  return snapshot;
}

export function useOperationsSyncSnapshot(gateway: OperationsGateway) {
  const [snapshot, setSnapshot] = useState(() => gateway.getSyncSnapshot());

  useEffect(() => {
    const publish = () => setSnapshot(gateway.getSyncSnapshot());
    publish();
    return gateway.subscribeSync(publish);
  }, [gateway]);

  return snapshot;
}
