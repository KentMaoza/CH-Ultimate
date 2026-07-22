export interface NotaPageTheme { background: string; foreground: string }

const pageThemes: NotaPageTheme[] = [
  { background: '#D32F2F', foreground: '#FFFFFF' },
  { background: '#1565C0', foreground: '#FFFFFF' },
  { background: '#FBC02D', foreground: '#111111' },
  { background: '#2E7D32', foreground: '#FFFFFF' },
  { background: '#EF6C00', foreground: '#FFFFFF' },
  { background: '#6A1B9A', foreground: '#FFFFFF' },
  { background: '#00796B', foreground: '#FFFFFF' },
  { background: '#C2185B', foreground: '#FFFFFF' },
  { background: '#00838F', foreground: '#FFFFFF' },
  { background: '#9E9D24', foreground: '#111111' },
  { background: '#5D4037', foreground: '#FFFFFF' },
  { background: '#3949AB', foreground: '#FFFFFF' },
  { background: '#D84315', foreground: '#FFFFFF' },
  { background: '#0277BD', foreground: '#FFFFFF' },
  { background: '#558B2F', foreground: '#FFFFFF' },
  { background: '#512DA8', foreground: '#FFFFFF' },
  { background: '#FF8F00', foreground: '#111111' },
  { background: '#455A64', foreground: '#FFFFFF' },
  { background: '#B71C1C', foreground: '#FFFFFF' },
  { background: '#0D47A1', foreground: '#FFFFFF' },
  { background: '#1B5E20', foreground: '#FFFFFF' },
  { background: '#4A148C', foreground: '#FFFFFF' },
  { background: '#004D40', foreground: '#FFFFFF' },
  { background: '#880E4F', foreground: '#FFFFFF' },
  { background: '#E65100', foreground: '#FFFFFF' },
  { background: '#006064', foreground: '#FFFFFF' },
];

export function notaPageTheme(pageIndex: number): NotaPageTheme {
  return pageThemes[((pageIndex % pageThemes.length) + pageThemes.length) % pageThemes.length]!;
}
