import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import type { Sku } from '../../src/domain/types';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { GatewaySkuImage } from '../../src/renderer/components/GatewaySkuImage';

const sku = new MockOperationsGateway().getSnapshot().skus[0]!;

test('gateway image component loads the hash-backed source and reloads when the hash changes', async () => {
  const gateway = new MockOperationsGateway();
  const load = vi.spyOn(gateway, 'loadSkuImage')
    .mockResolvedValueOnce('data:image/png;base64,YQ==')
    .mockResolvedValueOnce('data:image/png;base64,Yg==');
  const first: Sku = { ...sku, imageUrl: '', imageHash: 'a'.repeat(64) };
  const { rerender } = render(
    <GatewaySkuImage gateway={gateway} sku={first} className="sku-image" alt="Gambar SKU" />,
  );
  await expect(screen.findByAltText('Gambar SKU')).resolves
    .toHaveAttribute('src', 'data:image/png;base64,YQ==');

  rerender(
    <GatewaySkuImage gateway={gateway} sku={{ ...first, imageHash: 'b'.repeat(64) }} className="sku-image" alt="Gambar SKU" />,
  );
  await expect(screen.findByAltText('Gambar SKU')).resolves
    .toHaveAttribute('src', 'data:image/png;base64,Yg==');
  expect(load).toHaveBeenCalledTimes(2);
});

test('gateway image component uses the CHU fallback for a missing source or load failure', async () => {
  const gateway = new MockOperationsGateway();
  vi.spyOn(gateway, 'loadSkuImage').mockRejectedValue(new Error('IMAGE_UNAVAILABLE'));
  render(
    <GatewaySkuImage
      gateway={gateway}
      sku={{ ...sku, imageUrl: '', imageHash: 'a'.repeat(64) }}
      className="sku-image"
      alt="Gambar SKU"
    />,
  );
  expect(await screen.findByText('CHU')).toBeInTheDocument();
});
