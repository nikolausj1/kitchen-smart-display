// Inline 16 px icons for the tool chrome. currentColor throughout.

const base = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }

export function EyeIcon() {
  return (
    <svg {...base}>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  )
}

export function EyeOffIcon() {
  return (
    <svg {...base}>
      <path d="M2 2l12 12" />
      <path d="M6.3 3.8A6.9 6.9 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11.6 11.6 0 0 1-1.9 2.5M10.2 11.9A6.3 6.3 0 0 1 8 12.5C3.9 12.5 1.5 8 1.5 8a11.3 11.3 0 0 1 2.6-3" />
    </svg>
  )
}

export function LockIcon() {
  return (
    <svg {...base}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  )
}

export function UnlockIcon() {
  return (
    <svg {...base}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1" />
    </svg>
  )
}

export function UpIcon() {
  return (
    <svg {...base}>
      <path d="M4 10l4-4 4 4" />
    </svg>
  )
}

export function DownIcon() {
  return (
    <svg {...base}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  )
}

export function UndoIcon() {
  return (
    <svg {...base}>
      <path d="M5.5 3.5L2.5 6.5l3 3" />
      <path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" />
    </svg>
  )
}

export function RedoIcon() {
  return (
    <svg {...base}>
      <path d="M10.5 3.5l3 3-3 3" />
      <path d="M13.5 6.5h-7a4 4 0 0 0 0 8H9" />
    </svg>
  )
}

export function TextIcon() {
  return (
    <svg {...base}>
      <path d="M3 4V3h10v1M8 3v10M6 13h4" />
    </svg>
  )
}

export function ImageIcon() {
  return (
    <svg {...base}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1.2" />
      <path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" />
    </svg>
  )
}

export function PanelIcon() {
  return (
    <svg {...base}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M2.5 6h11" />
    </svg>
  )
}
