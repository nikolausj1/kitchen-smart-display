// specStyles.js - what a box's editor-foundation props draw as
// (docs/designs/panels-and-controls.md, chunk 1; the props are layoutSpec.js
// ELEMENT_STYLE_SCHEMA and BOX_SCHEMA). Pure: no React, no DOM, testable
// from Node. Entry/SpecPanel applies the results; SpecPanel.css holds the
// rules they switch on.
//
//   elementStylesCss(boxId, elements)  the box's scoped stylesheet
//   shrinkKeysOf(elements)             the keys that shrink to fit, 'a,b'
//   boxLook(props, type)               classes, inline style, the fill layer,
//                                      the box shadow, and the title override
//   linearGradient(gradient, from, to) a box v2 gradient between two colours
//                                      (the countdown tiles' cards use it too)
//
// Everything is absent at the defaults: no stylesheet, no class, no style, so
// a box nobody styled draws exactly as it did before these props existed.
//
// Runtime rule (layoutSpec.js): Chrome 80 on the Echo, so no CSS `inset`,
// flex `gap`, `aspect-ratio` or :where() in what this writes.

import { fontStack } from '../lib/fonts.js'

const SAFE_ID = /^[A-Za-z0-9_-]+$/
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const WEIGHTS = [300, 400, 500, 600, 700, 800]

function isObj(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function finite(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

function hex(v) {
  return typeof v === 'string' && HEX_RE.test(v) ? v : null
}

// '#f2f2f0' -> '242, 242, 240' (any alpha dropped), or null.
export function hexChannels(v) {
  if (!hex(v)) return null
  let h = v.slice(1)
  if (h.length <= 4) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

// --- Element styles ---------------------------------------------------------------
//
// One rule per styled key, scoped to its box: [data-box="<id>"] [data-edit=
// "<key>"]. The element's own rule names data-edit twice, so it out-ranks an
// outer key's rule for its children (a tile's colour does not beat its own
// number's). Declarations are !important where a panel sets the same
// property inline or in a more specific rule (the clock's weight knob is an
// inline font-weight).
//
// Size never writes a font-size: it multiplies the element's text scale,
//   --tl-text-scale: calc(var(--tl-knob-scale) * var(--tl-el-size) * var(--tl-el-fit))
// where --tl-knob-scale is the box's scale times the panel's own size knob
// for that element (tokens.css "Panel knobs"), --tl-el-size this style's
// size, and --tl-el-fit the shrink-to-fit factor (lib/fitText.js). Every font
// size in the panels multiplies by --tl-text-scale, and the knob rules use the
// same product, so an element's size, its knob and the fitter compose however
// the element and the knob's element nest. Art does not scale.
const TEXT_SCALE = 'calc(var(--tl-knob-scale, 1) * var(--tl-el-size, 1) * var(--tl-el-fit, 1))'

function num4(n) {
  return Math.round(n * 10000) / 10000
}

export function elementStylesCss(boxId, elements) {
  if (typeof boxId !== 'string' || !SAFE_ID.test(boxId) || !isObj(elements)) return ''
  const scope = `[data-box="${boxId}"]`
  let css = ''
  Object.keys(elements).forEach((key) => {
    const s = elements[key]
    if (!SAFE_ID.test(key) || !isObj(s)) return
    const self = `${scope} [data-edit="${key}"][data-edit]`
    if (s.hidden === true) {
      css += `${self}{display:none!important}\n`
      return
    }
    const own = []
    // Inherited properties the panels also set on the element's children
    // (a meridiem's weight, a unit's colour): written for both.
    const deep = []
    const size = finite(s.size) && s.size > 0 ? num4(s.size) : 1
    if (size !== 1) own.push(`--tl-el-size:${size}`)
    if (size !== 1 || s.fit === 'shrink') own.push(`--tl-text-scale:${TEXT_SCALE}`)
    if (WEIGHTS.indexOf(s.weight) >= 0) deep.push(`font-weight:${s.weight}!important`)
    if (hex(s.color)) deep.push(`color:${s.color}!important`)
    if (finite(s.spaceAbove) && s.spaceAbove > 0) own.push(`margin-top:calc(var(--tl-pad) * ${num4(s.spaceAbove)})!important`)
    if (finite(s.spaceBelow) && s.spaceBelow > 0) own.push(`margin-bottom:calc(var(--tl-pad) * ${num4(s.spaceBelow)})!important`)
    if (finite(s.tracking) && s.tracking !== 0) deep.push(`letter-spacing:${num4(s.tracking)}em!important`)
    if (s.caps === true) deep.push('text-transform:uppercase!important')
    if (s.fit === 'clip') {
      own.push('overflow:hidden!important')
      deep.push('text-overflow:clip!important')
    }
    if (own.length || deep.length) css += `${self}{${own.concat(deep).join(';')}}\n`
    if (deep.length) css += `${scope} [data-edit="${key}"] *{${deep.join(';')}}\n`
  })
  return css
}

// 'key,key' of the styled elements that shrink to fit ('' for none): the
// fitter's list, and a string so it can be a hook dependency.
export function shrinkKeysOf(elements) {
  if (!isObj(elements)) return ''
  return Object.keys(elements)
    .filter((k) => SAFE_ID.test(k) && isObj(elements[k]) && elements[k].fit === 'shrink' && elements[k].hidden !== true)
    .join(',')
}

// --- The box v2 look ------------------------------------------------------------

const GRADIENT_DIRS = { down: 'to bottom', right: 'to right', diagonal: 'to bottom right' }

// linearGradient('down' | 'right' | 'diagonal', from, to) -> the CSS
// gradient between two colours in that direction, or null for 'none' (or
// anything else). The box fill below draws with it, and so do the countdown
// tiles' gradient cards (lib/tileColor.js tileVars).
export function linearGradient(gradient, from, to) {
  const dir = typeof gradient === 'string' && Object.prototype.hasOwnProperty.call(GRADIENT_DIRS, gradient) ? GRADIENT_DIRS[gradient] : null
  return dir ? `linear-gradient(${dir}, ${from}, ${to})` : null
}

// Drop shadows in the layout's padding unit, so they scale with the screen.
const SHADOWS = {
  soft: '0 calc(var(--tl-pad) * 0.15) calc(var(--tl-pad) * 0.9) rgba(0, 0, 0, 0.3)',
  strong: '0 calc(var(--tl-pad) * 0.35) calc(var(--tl-pad) * 1.8) rgba(0, 0, 0, 0.55)',
}

// The preset card's hairline (SpecPanel.css .tl-spec--bg-card).
const EDGE = 'inset 0 0 0 1px var(--tl-spec-edge)'

// Pixels drawn at 1920 wide, as a share of the screen's width.
function vw(px) {
  return `${num4((px * 100) / 1920)}vw`
}

// The tint that stands in for a blur the screen cannot draw: stronger with
// the blur asked for, never opaque.
export function blurTintAlpha(blur) {
  return num4(Math.min(0.55, 0.15 + blur * 0.02))
}

// boxLook(props, type) -> {
//   classes    extra classes for the box (SpecPanel.css)
//   style      extra inline style (variables, font, colour)
//   fill       { background, opacity } for the fill layer, or null
//   boxShadow  the box's own shadow when the look replaces the preset's, or
//              null (the preset's rules apply)
//   rounded    the box draws its corner radius even with no preset background
//   title      { mode: 'custom' | 'none', text } or null (the panel's own)
// }
export function boxLook(props, type) {
  const p = isObj(props) ? props : {}
  const out = { classes: [], style: {}, fill: null, boxShadow: null, rounded: false, title: null }
  const preset = p.background
  const presetFill = preset === 'card' ? 'var(--tl-spec-card)' : preset === 'solid' ? 'var(--tl-surface-solid)' : null

  // The fill: a layer under the content (SpecPanel.css .tl-spec__fill), so its
  // opacity fades the fill alone. A colour replaces the preset's; without one
  // a gradient or an opacity works on the preset's own fill.
  const bg = isObj(p.bg) ? p.bg : null
  if (bg) {
    const c1 = hex(bg.color) || presetFill
    const c2 = hex(bg.color2)
    const gradient = c1 || c2 ? linearGradient(bg.gradient, c1 || 'transparent', c2 || 'transparent') : null
    let background = null
    if (gradient) background = gradient
    else if (c1) background = c1
    if (background) {
      out.fill = { background, opacity: finite(bg.opacity) && bg.opacity < 1 ? Math.max(0, bg.opacity) : null }
      out.classes.push('tl-spec--fill')
    }
  }

  // The frame: the border and the preset's hairline, drawn above the fill
  // (.tl-spec--frame::after); the box's own shadow is then the drop shadow
  // alone.
  const border = isObj(p.border) ? p.border : null
  const bw = border && finite(border.width) && border.width > 0 ? Math.min(4, border.width) : 0
  const shadow = Object.prototype.hasOwnProperty.call(SHADOWS, p.shadow) ? SHADOWS[p.shadow] : null
  const blur = finite(p.blur) && p.blur > 0 ? Math.min(20, p.blur) : 0
  if (out.fill || bw || shadow || blur) {
    out.rounded = true
    const frame = []
    if (bw) frame.push(`inset 0 0 0 max(1px, ${vw(bw)}) ${hex(border.color) || 'rgba(var(--tl-fg-rgb), 0.35)'}`)
    if (presetFill) frame.push(EDGE)
    if (frame.length) {
      out.classes.push('tl-spec--frame')
      out.style['--tl-spec-frame'] = frame.join(', ')
    }
    out.boxShadow = shadow || 'none'
  }
  if (blur) {
    out.classes.push('tl-spec--blur')
    out.style['--tl-spec-blur'] = vw(blur)
    out.style['--tl-spec-tint'] = `rgba(8, 10, 12, ${blurTintAlpha(blur)})`
  }

  // Type: a font for every word in the box, a text colour with the two
  // quieter inks derived from it (tokens.css --tl-fg-2, --tl-fg-3).
  const stack = typeof p.font === 'string' && p.font !== 'inherit' ? fontStack(p.font) : null
  if (stack) {
    out.style.fontFamily = stack
    out.style['--tl-font-display'] = stack
    out.style['--tl-font-body'] = stack
  }
  if (type !== 'text') {
    const c = hex(p.color)
    const ch = c ? hexChannels(c) : null
    if (ch) {
      out.style.color = c
      out.style['--tl-fg'] = c
      out.style['--tl-fg-rgb'] = ch
      out.style['--tl-fg-2'] = `rgba(${ch}, 0.68)`
      out.style['--tl-fg-3'] = `rgba(${ch}, 0.42)`
    }
  }

  if (p.valign === 'middle' || p.valign === 'bottom') out.classes.push(`tl-spec--valign-${p.valign}`)

  const t = isObj(p.title) ? p.title : null
  if (t && (t.mode === 'custom' || t.mode === 'none')) {
    out.title = { mode: t.mode, text: t.mode === 'custom' && typeof t.text === 'string' ? t.text.trim() : '' }
  }
  return out
}
