import { StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { ChCoreBridge } from '../electron/core-bridge-contract';
import { App } from './App';
import { CoreConnectionScreen } from './CoreConnectionScreen';
import {
  bootstrapDesktopGateway,
  type DesktopBootstrapResult,
  type DesktopRuntimeMode,
} from './core-api-bootstrap';
import './styles.css';

interface DesktopRendererOptions {
  bridge?: ChCoreBridge;
  mode: DesktopRuntimeMode;
}

function disposeGateway(result: DesktopBootstrapResult | undefined): void {
  if (result?.kind === 'gateway' && result.source === 'core') {
    result.gateway.dispose();
  }
}

export function mountDesktopRenderer(
  root: Root,
  options: DesktopRendererOptions,
): () => void {
  let current: DesktopBootstrapResult | undefined;
  let generation = 0;

  const render = (content: ReactNode) => {
    root.render(<StrictMode>{content}</StrictMode>);
  };

  const retry = async (): Promise<void> => {
    const activeGeneration = ++generation;
    disposeGateway(current);
    current = undefined;
    render(
      <CoreConnectionScreen
        status={{
          production: options.mode === 'production',
          configuration: 'ready',
          credential: 'pending',
          message: 'Menghubungkan ke CH Core.',
        }}
        onRetry={retry}
      />,
    );

    let next: DesktopBootstrapResult;
    try {
      next = await bootstrapDesktopGateway(options);
    } catch {
      if (activeGeneration !== generation) return;
      render(
        <CoreConnectionScreen
          status={{
            production: options.mode === 'production',
            configuration: 'invalid',
            credential: 'unpaired',
            message: 'CH Core tidak dapat dimulai. Coba lagi.',
          }}
          bridge={options.bridge}
          onRetry={retry}
        />,
      );
      return;
    }
    if (activeGeneration !== generation) {
      disposeGateway(next);
      return;
    }
    current = next;
    if (next.kind === 'connection') {
      render(
        <CoreConnectionScreen
          status={next.status}
          bridge={options.bridge}
          onRetry={retry}
        />,
      );
      return;
    }
    render(
      <App
        gateway={next.gateway}
        coreBacked={next.source === 'core'}
      />,
    );
  };

  void retry();
  return () => {
    generation += 1;
    disposeGateway(current);
    root.unmount();
  };
}

mountDesktopRenderer(
  createRoot(document.getElementById('root')!),
  {
    bridge: window.chCore,
    mode: import.meta.env.PROD ? 'production' : 'development',
  },
);
