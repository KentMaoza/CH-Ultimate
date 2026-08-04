import { act, render, screen } from '@testing-library/react';
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

test('exposes an accessible image fallback when IntersectionObserver is unavailable', () => {
  const gateway = new MockOperationsGateway();
  vi.spyOn(gateway, 'loadSkuImage').mockReturnValue(new Promise(() => {}));

  render(
    <GatewaySkuImage
      gateway={gateway}
      sku={{ ...sku, imageUrl: '', imageHash: 'a'.repeat(64) }}
      alt="Gambar Beras"
    />,
  );

  expect(screen.getByRole('img', { name: 'Gambar Beras' })).toHaveTextContent('CHU');
});

test('does not load offscreen catalogue images and disconnects visibility observers on unmount', async () => {
  const previousObserver = globalThis.IntersectionObserver;
  const observed: Element[] = [];
  const disconnected: Array<ReturnType<typeof vi.fn>> = [];
  const callbacks: IntersectionObserverCallback[] = [];
  class TestIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '240px';
    readonly thresholds = [0];
    readonly disconnect = vi.fn();
    constructor(callback: IntersectionObserverCallback) {
      callbacks.push(callback);
      disconnected.push(this.disconnect);
    }
    observe(target: Element): void { observed.push(target); }
    takeRecords(): IntersectionObserverEntry[] { return []; }
    unobserve(): void {}
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: TestIntersectionObserver,
  });
  try {
    const gateway = new MockOperationsGateway();
    const load = vi.spyOn(gateway, 'loadSkuImage')
      .mockResolvedValue('data:image/png;base64,YQ==');
    const items = Array.from({ length: 40 }, (_, index) => ({
      ...sku,
      id: `${sku.id}-${index}`,
      imageUrl: '',
      imageHash: index.toString(16).padStart(64, '0'),
    }));
    const view = render(<>{items.map((item) => (
      <GatewaySkuImage key={item.id} gateway={gateway} sku={item} alt={item.name} />
    ))}</>);

    expect(load).not.toHaveBeenCalled();
    expect(observed).toHaveLength(40);
    await act(async () => {
      callbacks[0]?.([{
        isIntersecting: true,
        target: observed[0]!,
      } as IntersectionObserverEntry], {} as IntersectionObserver);
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    view.unmount();
    expect(disconnected.every((disconnect) => disconnect.mock.calls.length === 1)).toBe(true);
  } finally {
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      value: previousObserver,
    });
  }
});
