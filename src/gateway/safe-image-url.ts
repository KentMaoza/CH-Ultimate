export function safeRemoteImageUrl(value: string | null | undefined): string {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname.toLowerCase() !== 'res.bigseller.pro' ||
      parsed.port !== '' ||
      parsed.username !== '' ||
      parsed.password !== ''
    ) {
      return '';
    }
    return parsed.href;
  } catch {
    return '';
  }
}
