import { formatSkuShareText } from '../domain/sku-share';
import type { Sku } from '../domain/types';

export type DesktopShareResult = 'shared' | 'cancelled' | 'fallback';

export interface ShareNavigator {
  share?(data: ShareData): Promise<void>;
  canShare?(data: ShareData): boolean;
}

type Fetcher = (input: RequestInfo | URL) => Promise<Response>;

interface DownloadDependencies {
  loadFile: (sku: Sku) => Promise<File | null>;
  createObjectURL: (file: File) => string;
  revokeObjectURL: (url: string) => void;
  download: (url: string, filename: string) => void;
}

function imageExtension(mimeType: string): string {
  if (mimeType === 'image/svg+xml') return 'svg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/jpeg') return 'jpg';
  return 'img';
}

function safeSkuNumber(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'sku';
}

export async function loadSkuShareFile(
  sku: Sku,
  fetcher: Fetcher = fetch,
): Promise<File | null> {
  if (!sku.imageUrl) return null;
  const response = await fetcher(sku.imageUrl);
  if (!response.ok) throw new Error('Gambar produk tidak dapat dimuat.');
  const blob = await response.blob();
  const bytes = await blob.arrayBuffer();
  const extension = imageExtension(blob.type);
  return new File([bytes], `${safeSkuNumber(sku.skuNumber)}.${extension}`, { type: blob.type });
}

export async function shareSkuWithSystem(
  sku: Sku,
  shareNavigator: ShareNavigator = navigator as ShareNavigator,
  loadFile: (sku: Sku) => Promise<File | null> = loadSkuShareFile,
): Promise<DesktopShareResult> {
  if (!shareNavigator.share) return 'fallback';
  const data: ShareData = {
    title: sku.name,
    text: formatSkuShareText(sku),
  };
  const file = sku.imageUrl ? await loadFile(sku).catch(() => null) : null;
  if (file && shareNavigator.canShare?.({ files: [file] })) data.files = [file];

  try {
    await shareNavigator.share(data);
    return 'shared';
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError'
      ? 'cancelled'
      : 'fallback';
  }
}

function clickDownload(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

export async function downloadSkuImage(
  sku: Sku,
  dependencies: DownloadDependencies = {
    loadFile: loadSkuShareFile,
    createObjectURL: URL.createObjectURL.bind(URL),
    revokeObjectURL: URL.revokeObjectURL.bind(URL),
    download: clickDownload,
  },
): Promise<boolean> {
  const file = await dependencies.loadFile(sku);
  if (!file) return false;
  const url = dependencies.createObjectURL(file);
  try {
    dependencies.download(url, file.name);
    return true;
  } finally {
    dependencies.revokeObjectURL(url);
  }
}
