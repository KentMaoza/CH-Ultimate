export function formatRupiah(value: number): string {
  return `Rp${Math.round(value).toLocaleString('id-ID')}`;
}

export function formatWita(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `${value} WITA`;
  return `${new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Makassar',
  }).format(date).replace('.', ':')} WITA`;
}
