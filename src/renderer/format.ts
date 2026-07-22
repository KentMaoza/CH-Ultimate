export function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '—';
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Makassar' }).format(date);
}

export function capitalizeSentenceStarts(value: string): string {
  let sentenceStart = true;
  const characters = Array.from(value);
  return characters.map((character, index) => {
    if (sentenceStart && /\p{L}/u.test(character)) {
      sentenceStart = false;
      return character.toLocaleUpperCase('id-ID');
    }
    if ((character === '.' && (!characters[index + 1] || /\s/u.test(characters[index + 1]!))) || character === '?' || character === '!' || character === '\n') sentenceStart = true;
    return character;
  }).join('');
}
