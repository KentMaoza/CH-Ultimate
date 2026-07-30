import { open } from 'node:fs/promises';

export async function readBoundedFile(
  filePath: string,
  maxBytes: number,
): Promise<Buffer> {
  const file = await open(filePath, 'r');
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > maxBytes) {
      throw new Error('File exceeds its allowed size.');
    }

    const bytes = Buffer.alloc(metadata.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > metadata.size || offset > maxBytes) {
      throw new Error('File changed during bounded read.');
    }
    return bytes.subarray(0, offset);
  } finally {
    await file.close();
  }
}
