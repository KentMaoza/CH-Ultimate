const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_LONGEST_EDGE = 1600;
const JPEG_QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4];

interface DecodedMobileImage {
  width: number;
  height: number;
  source: CanvasImageSource;
  close?: () => void;
}

interface MobileImageProcessor {
  decode(file: File): Promise<DecodedMobileImage>;
  encode(
    source: CanvasImageSource,
    width: number,
    height: number,
    quality: number,
  ): Promise<Blob>;
}

const browserProcessor: MobileImageProcessor = {
  async decode(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      close: () => bitmap.close(),
    };
  },
  async encode(source, width, height, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Gambar tidak dapat diproses di perangkat ini.');
    context.drawImage(source, 0, 0, width, height);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Gambar tidak dapat dikompresi.')),
        'image/jpeg',
        quality,
      );
    });
  },
};

export async function preprocessMobileSkuImage(
  file: File,
  processor: MobileImageProcessor = browserProcessor,
): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Pilih file gambar yang valid.');
  }
  const decoded = await processor.decode(file);
  try {
    const scale = Math.min(1, MAX_LONGEST_EDGE / Math.max(decoded.width, decoded.height));
    let width = Math.max(1, Math.round(decoded.width * scale));
    let height = Math.max(1, Math.round(decoded.height * scale));
    while (width >= 320 || height >= 320) {
      for (const quality of JPEG_QUALITIES) {
        const result = await processor.encode(decoded.source, width, height, quality);
        if (result.size <= MAX_IMAGE_BYTES) return result;
      }
      width = Math.max(1, Math.round(width * 0.8));
      height = Math.max(1, Math.round(height * 0.8));
    }
    throw new Error('Gambar tidak dapat dikompresi hingga 5 MiB.');
  } finally {
    decoded.close?.();
  }
}

export function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Gambar tidak dapat dibaca.'));
    reader.onerror = () => reject(reader.error ?? new Error('Gambar tidak dapat dibaca.'));
    reader.readAsDataURL(blob);
  });
}
