// fonts.js - the type families a spec layout (the Entry board, the Board) can
// use: the global display font (spec.global.font, panels/schemas.js
// GLOBAL_SCHEMA) and a box's own font (the universal `font`, layoutSpec.js
// BOX_SCHEMA). One registry, so the two lists never drift apart.
//
//   id     what a spec stores ('inter', 'roboto')
//   label  what the editor shows
//   stack  the CSS font-family value. Inter's and Fraunces' are exactly
//          tokens.css's --tl-font-inter and --tl-font-fraunces.
//
// The faces are bundled by Entry/SpecBoard.jsx (@fontsource latin subsets:
// Inter 300 there and 400/600/700 in main.jsx, Fraunces variable, Roboto and
// IBM Plex Mono 400/500/700, Barlow Condensed 400/500/600/700). A browser
// downloads a face only when a page uses it, so an unused family costs
// nothing on a screen. A weight a family lacks falls to its nearest face.
//
// Pure data (no React, no DOM), importable from Node. Runtime rule
// (layoutSpec.js): Silk on the Echo may be as old as Chrome 80.

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    Object.keys(o).forEach((k) => deepFreeze(o[k]))
  }
  return o
}

export const FONTS = deepFreeze([
  { id: 'inter', label: 'Inter', stack: "'Inter', -apple-system, system-ui, sans-serif" },
  { id: 'fraunces', label: 'Fraunces', stack: "'Fraunces Variable', Georgia, 'Times New Roman', serif" },
  { id: 'roboto', label: 'Roboto', stack: "'Roboto', -apple-system, system-ui, sans-serif" },
  { id: 'barlow', label: 'Barlow Condensed', stack: "'Barlow Condensed', 'Arial Narrow', sans-serif" },
  { id: 'plexmono', label: 'IBM Plex Mono', stack: "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace" },
])

export const FONT_IDS = deepFreeze(FONTS.map((f) => f.id))

// The global display font's default (panels/schemas.js GLOBAL_SCHEMA).
export const DEFAULT_FONT = 'inter'

// The entry for an id, or null.
export function fontById(id) {
  for (let i = 0; i < FONTS.length; i++) if (FONTS[i].id === id) return FONTS[i]
  return null
}

// The CSS font-family value for an id, or null.
export function fontStack(id) {
  const f = fontById(id)
  return f ? f.stack : null
}
