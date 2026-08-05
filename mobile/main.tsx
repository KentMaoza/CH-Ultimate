import { StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { createMobileDemoState } from '../src/domain/mobile-demo-state';
import { MockOperationsGateway } from '../src/gateway/operations-gateway';
import { ClientErrorBoundary } from '../src/renderer/ClientErrorBoundary';
import { MobileApp } from './MobileApp';
import { createNativeAppBackButton } from './native-adapters';
import { browserAppBackButton, type AppBackButtonPort } from './ports';
import { createMobileRuntime } from './bootstrap';
import { CoreConnectionScreen } from './components/CoreConnectionScreen';
import {
  bootstrapMobileGateway,
  type MobileBootstrapResult,
} from './core-api-bootstrap';
import {
  type MobileCoreBridge,
} from './core-api-native';
import type { MobilePorts } from './bootstrap';
import './styles.css';

const logCoreDiagnostic = (diagnostic: unknown) => {
  console.error('CH Core bootstrap validation failed.', diagnostic);
};

interface MobileRendererOptions {
  backButton?: AppBackButtonPort;
  native: boolean;
  bridge?: MobileCoreBridge;
  ports: MobilePorts;
}

function disposeGateway(result: MobileBootstrapResult | undefined) {
  if (result?.kind === 'gateway' && result.source === 'core') {
    result.gateway.dispose();
  }
}

export function mountMobileRenderer(
  root: Root,
  options: MobileRendererOptions,
): () => void {
  let current: MobileBootstrapResult | undefined;
  let generation = 0;
  let disposed = false;
  const backButton = options.backButton ?? (options.native ? createNativeAppBackButton() : browserAppBackButton);
  const render = (content: ReactNode) =>
    root.render(
      <StrictMode>
        <ClientErrorBoundary key={generation} onRetry={() => void retry()}>
          {content}
        </ClientErrorBoundary>
      </StrictMode>,
    );

  const retry = async (): Promise<void> => {
    const activeGeneration = ++generation;
    disposeGateway(current);
    current = undefined;
    if (options.native) {
      render(
        <CoreConnectionScreen
          status={{
            production: true,
            configuration: 'ready',
            credential: 'pending',
            message: 'Menghubungkan ke CH Core.',
          }}
          onRetry={retry}
        />,
      );
    }

    let next: MobileBootstrapResult;
    try {
      next = await bootstrapMobileGateway({
        native: options.native,
        bridge: options.bridge,
        diagnosticSink: logCoreDiagnostic,
        demoFactory: () =>
          new MockOperationsGateway(createMobileDemoState),
      });
    } catch {
      if (activeGeneration !== generation) return;
      render(
        <CoreConnectionScreen
          status={{
            production: options.native,
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
      <MobileApp
        backButton={backButton}
        coreBacked={next.source === 'core'}
        gateway={next.gateway}
        notifications={options.ports.notifications}
        scanner={options.ports.scanner}
        share={options.ports.share}
      />,
    );
  };

  void retry();
  return () => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    disposeGateway(current);
    void backButton.dispose().catch(() => undefined);
    root.unmount();
  };
}

const native = Capacitor.isNativePlatform();
const runtime = createMobileRuntime(native);
mountMobileRenderer(
  createRoot(document.getElementById('root')!),
  {
    native,
    bridge: runtime.bridge,
    ports: runtime.ports,
  },
);
