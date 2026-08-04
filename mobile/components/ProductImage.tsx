import type { Sku } from '../../src/domain/types';
import type { OperationsGateway } from '../../src/gateway/operations-gateway';
import { GatewaySkuImage } from '../../src/renderer/components/GatewaySkuImage';
import { BoxIcon } from './Icons';

export function ProductImage({ gateway, sku }: { gateway: OperationsGateway; sku: Sku }) {
  return <GatewaySkuImage
    gateway={gateway}
    sku={sku}
    className="product-image product-image-fallback"
    alt=""
    fallback={<BoxIcon />}
    fallbackTestId={`image-fallback-${sku.id}`}
  />;
}
