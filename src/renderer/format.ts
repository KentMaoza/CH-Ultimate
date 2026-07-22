export function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '—';
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Makassar' }).format(date);
}

export function formatTitleCaseWords(value: string): string {
  return value.split(/(\s+)/u).map((token) => {
    if (!/\p{L}/u.test(token)) return token;
    if (/^ch\d+\p{P}*$/iu.test(token)) return token.toLocaleUpperCase('id-ID');
    if (token === token.toLocaleUpperCase('id-ID')) return token;
    const lower = token.toLocaleLowerCase('id-ID');
    return lower.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase('id-ID'));
  }).join('');
}

export function formatTitleCaseInput(input: HTMLInputElement | HTMLTextAreaElement): string {
  const start = input.selectionStart;
  const end = input.selectionEnd;
  if (start !== null) queueMicrotask(() => input.setSelectionRange(start, end ?? start));
  return formatTitleCaseWords(input.value);
}
