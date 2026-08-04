import { useEffect, useState, type ReactNode } from 'react';

import type { Sku } from '../../domain/types';
import type { OperationsGateway } from '../../gateway/operations-gateway-contract';

export function GatewaySkuImage({
  gateway,
  sku,
  className,
  alt,
  fallback = 'CHU',
  fallbackTestId,
}: {
  gateway: OperationsGateway;
  sku: Sku;
  className?: string;
  alt: string;
  fallback?: ReactNode;
  fallbackTestId?: string;
}) {
  const [source, setSource] = useState(() => sku.imageHash ? '' : sku.imageUrl);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    if (!sku.imageHash) {
      setSource(sku.imageUrl);
      return () => {
        active = false;
      };
    }
    setSource('');
    void gateway.loadSkuImage(sku).then((next) => {
      if (!active) return;
      if (next) setSource(next);
      else setFailed(true);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [gateway, sku.id, sku.imageHash, sku.imageUrl]);

  return source && !failed
    ? <img className={className} src={source} alt={alt} onError={() => setFailed(true)} />
    : <span className={className} data-testid={fallbackTestId} aria-hidden={alt ? undefined : true} aria-label={alt || undefined}>{fallback}</span>;
}
