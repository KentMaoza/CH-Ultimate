import { useEffect, useRef, useState, type ReactNode } from 'react';

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
  const canObserve = typeof IntersectionObserver !== 'undefined';
  const target = useRef<Element | null>(null);
  const [visible, setVisible] = useState(!canObserve);
  const [source, setSource] = useState(() => (
    !canObserve && !sku.imageHash ? sku.imageUrl : ''
  ));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!canObserve) {
      setVisible(true);
      return;
    }
    const element = target.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: '240px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [canObserve]);

  useEffect(() => {
    let active = true;
    setFailed(false);
    if (!visible) {
      setSource('');
      return () => {
        active = false;
      };
    }
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
  }, [gateway, sku.id, sku.imageHash, sku.imageUrl, visible]);

  return source && !failed
    ? <img ref={(node) => { target.current = node; }} className={className} src={source} alt={alt} onError={() => setFailed(true)} />
    : <span ref={(node) => { target.current = node; }} className={className} data-testid={fallbackTestId} role={alt ? 'img' : undefined} aria-hidden={alt ? undefined : true} aria-label={alt || undefined}>{fallback}</span>;
}
