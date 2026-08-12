import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { OutputDocumentPlan } from '../domain/output-documents';
import type {
  ChOutputBridge,
  PrintDocumentResult,
  SavePdfResult,
} from '../electron/output-contract';
import { PrintDocumentHost } from './output/PrintDocumentHost';

interface OutputContextValue {
  busy: boolean;
  print(plan: OutputDocumentPlan): Promise<PrintDocumentResult>;
  savePdf(plan: OutputDocumentPlan): Promise<SavePdfResult>;
}

const OutputContext = createContext<OutputContextValue | null>(null);

async function waitForHostReady(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  const host = document.querySelector<HTMLElement>('[data-testid="print-document-host"]');
  if (!host) throw new Error('Dokumen output belum siap.');
  await document.fonts?.ready;
  await Promise.all([...host.querySelectorAll('img')].map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 3_000);
      const done = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      image.addEventListener('load', done, { once: true });
      image.addEventListener('error', done, { once: true });
    });
  }));
}

export function OutputProvider({
  bridge,
  children,
}: {
  bridge?: ChOutputBridge;
  children: ReactNode;
}) {
  const [plan, setPlan] = useState<OutputDocumentPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = useCallback(async <T,>(
    nextPlan: OutputDocumentPlan,
    invoke: (activeBridge: ChOutputBridge) => Promise<T>,
  ): Promise<T> => {
    if (!bridge) throw new Error('Output desktop tidak tersedia.');
    if (busyRef.current) throw new Error('Output lain masih diproses.');
    busyRef.current = true;
    setBusy(true);
    setPlan(nextPlan);
    try {
      await waitForHostReady();
      return await invoke(bridge);
    } finally {
      // Keep the last trusted document mounted after the native print callback.
      // Windows can finish spooling after Electron reports success; removing the
      // host here lets a fast Print-to-PDF save capture a blank page.
      setBusy(false);
      busyRef.current = false;
    }
  }, [bridge]);

  const value = useMemo<OutputContextValue>(() => ({
    busy,
    print: (nextPlan) => run(nextPlan, (activeBridge) => activeBridge.printDocument({
      kind: nextPlan.kind,
      widthMm: nextPlan.widthMm,
      heightMm: nextPlan.heightMm,
    })),
    savePdf: (nextPlan) => run(nextPlan, (activeBridge) => activeBridge.savePdf({
      kind: nextPlan.kind,
      widthMm: nextPlan.widthMm,
      heightMm: nextPlan.heightMm,
      fileName: nextPlan.fileName,
    })),
  }), [busy, run]);

  return <OutputContext.Provider value={value}>
    {children}
    {plan ? <PrintDocumentHost plan={plan} /> : null}
  </OutputContext.Provider>;
}

export function useOutput(): OutputContextValue {
  const value = useContext(OutputContext);
  if (!value) throw new Error('OutputProvider is missing.');
  return value;
}
