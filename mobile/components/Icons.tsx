import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return <svg aria-hidden="true" fill="none" height="24" viewBox="0 0 24 24" width="24" {...props}>
    <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">{children}</g>
  </svg>;
}

export function BellIcon(props: IconProps) {
  return <IconBase {...props}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></IconBase>;
}

export function ScanIcon(props: IconProps) {
  return <IconBase {...props}><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 12h10" /></IconBase>;
}

export function SearchIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></IconBase>;
}

export function BoxIcon(props: IconProps) {
  return <IconBase {...props}><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="m4 7 8 4v10l-8-4V7ZM20 7l-8 4v10l8-4V7Z" /></IconBase>;
}

export function TrendIcon(props: IconProps) {
  return <IconBase {...props}><path d="m4 7 5 5 4-4 7 7" /><path d="M20 10v5h-5" /></IconBase>;
}

export function HomeIcon(props: IconProps) {
  return <IconBase {...props}><path d="m3 11 9-8 9 8" /><path d="M5 10v10h5v-6h4v6h5V10" /></IconBase>;
}

export function ClockIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v6l4 2" /></IconBase>;
}

export function ChevronIcon(props: IconProps) {
  return <IconBase {...props}><path d="m9 5 7 7-7 7" /></IconBase>;
}

export function BackIcon(props: IconProps) {
  return <IconBase {...props}><path d="m15 5-7 7 7 7" /></IconBase>;
}

export function InfoIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></IconBase>;
}

export function ShareIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="6" cy="12" r="2" /><circle cx="17" cy="6" r="2" /><circle cx="17" cy="18" r="2" /><path d="m8 11 7-4M8 13l7 4" /></IconBase>;
}

export function NotaIcon(props: IconProps) {
  return <IconBase {...props}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6M9 12h6M9 16h4" /></IconBase>;
}

export function ArchiveIcon(props: IconProps) {
  return <IconBase {...props}><path d="M4 7h16v13H4Z" /><path d="M3 4h18v4H3ZM9 12h6" /></IconBase>;
}

export function MoreIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></IconBase>;
}
