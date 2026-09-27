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

// A shape: a square with a circle over its corner.
export function ShapeIcon() {
  return (
    <svg {...base}>
      <rect x="2" y="6" width="8" height="8" rx="1.2" />
      <circle cx="10.5" cy="5.5" r="3.5" />
    </svg>
  )
}

// Any other block: a plain box.
export function BlockIcon() {
  return (
    <svg {...base}>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
    </svg>
  )
}

// A type the app does not know: a dashed box.
export function UnknownIcon() {
  return (
    <svg {...base}>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" strokeDasharray="2 1.8" />
    </svg>
  )
}

export function ChevronIcon({ open }) {
  return (
    <svg {...base} width={12} height={12} viewBox="0 0 12 12" style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.12s' }}>
      <path d="M4.5 3l3 3-3 3" />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg {...base}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg {...base} width={14} height={14}>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2l3.3 3.3" />
    </svg>
  )
}

export function MoreIcon() {
  return (
    <svg {...base}>
      <circle cx="3.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

// A rule: "shows only when". A small branching path.
export function RuleIcon({ size = 16 }) {
  return (
    <svg {...base} width={size} height={size}>
      <circle cx="4" cy="4" r="1.6" />
      <circle cx="4" cy="12" r="1.6" />
      <circle cx="12" cy="8" r="1.6" />
      <path d="M4 5.6v4.8M5.4 4.8c3 0 3.6 3.2 5 3.2" />
    </svg>
  )
}

// Alignment: a bar for the edge, boxes against it.
const ALIGN_PATHS = {
  left: ['M2.5 2v12', 'M4.5 4h8v3h-8z', 'M4.5 9h5v3h-5z'],
  centre: ['M8 2v12', 'M3.5 4h9v3h-9z', 'M5.5 9h5v3h-5z'],
  right: ['M13.5 2v12', 'M3.5 4h8v3h-8z', 'M6.5 9h5v3h-5z'],
  top: ['M2 2.5h12', 'M4 4.5v8h3v-8z', 'M9 4.5v5h3v-5z'],
  middle: ['M2 8h12', 'M4 3.5v9h3v-9z', 'M9 5.5v5h3v-5z'],
  bottom: ['M2 13.5h12', 'M4 3.5v8h3v-8z', 'M9 6.5v5h3v-5z'],
  distributeX: ['M2 2.5v11', 'M14 2.5v11', 'M5.5 5h2v6h-2z', 'M9.5 4h2v8h-2z'],
  distributeY: ['M2.5 2h11', 'M2.5 14h11', 'M5 5.5h6v2H5z', 'M4 9.5h8v2H4z'],
  matchW: ['M2.5 4h11v3h-11z', 'M2.5 10.5h11', 'M2.5 9v3M13.5 9v3'],
  matchH: ['M4 2.5v11h3v-11z', 'M10.5 2.5v11', 'M9 2.5h3M9 13.5h3'],
}

export function AlignIcon({ kind }) {
  return (
    <svg {...base}>
      {(ALIGN_PATHS[kind] || []).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
