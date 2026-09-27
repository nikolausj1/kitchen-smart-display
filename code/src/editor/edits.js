// edits.js - pure spec edits, the recipes Editor.jsx hands to
// actions.update(recipe). A recipe is (spec, part) => spec, where part is the
// day part being edited ('day' = the base panels and global, else a variant);
// the reducer passes the part it holds, so an edit always lands in the tab it
// was made in. Returning the same spec object means "nothing changed".

import { boxTopsFor, elementList, elementStyleFields, knobFields, UNIVERSAL_KEYS } from './schema.js'
import { cleanElementStyle, hasPart, isDict, partPanels, pctToPxRound, pxToPctKeeping } from './spec.js'
import { clamp, cloneJson, deepEqual, setPath } from './util.js'

const same = (obj, patch) => Object.keys(patch).every((k) => obj?.[k] === patch[k])
export const withBox = (box) => (p) => (same(p, box) ? p : { ...p, ...box })
export const withFields = (patch) => (p) => (same(p, patch) ? p : { ...p, ...patch })
export const withProps = (patch) => (p) => (same(p.props, patch) ? p : { ...p, props: { ...p.props, ...patch } })

// fn(panels) -> panels, on the part's own panel list. A part with no variant
// of its own is left alone (the editor offers "Create" there instead).
export function editPanels(spec, part, fn) {
  const panels = partPanels(spec, part)
  if (!panels) return spec
  const next = fn(panels)
  if (!next || next === panels) return spec
  if (part === 'day') return { ...spec, panels: next }
  return { ...spec, variants: { ...spec.variants, [part]: { ...spec.variants[part], panels: next } } }
}

export function mapPanel(spec, part, id, fn) {
  return mapPanels(spec, part, [id], fn)
}

// fn applied to every panel whose id is in `ids`, one change.
export function mapPanels(spec, part, ids, fn) {
  const set = new Set(ids)
  return editPanels(spec, part, (panels) => {
    let changed = false
    const out = panels.map((p) => {
      if (!set.has(p.id)) return p
      const n = fn(p)
      if (n !== p) changed = true
      return n
    })
    return changed ? out : panels
  })
}

export const removePanel = (spec, part, id) => removePanels(spec, part, [id])

export const removePanels = (spec, part, ids) =>
  editPanels(spec, part, (panels) => (panels.some((p) => ids.includes(p.id)) ? panels.filter((p) => !ids.includes(p.id)) : panels))

export const addPanel = (spec, part, panel) => editPanels(spec, part, (panels) => [...panels, panel])

// Of the panels whose id is in `ids`, the one drawn furthest back: the lowest
// z, and for a tie the first in the list (paint order is z, then the list's
// order, in the app and in frontToBack alike). null for none.
export function backmost(panels, ids) {
  let best = null
  panels.forEach((p, i) => {
    if (!ids.includes(p.id)) return
    if (!best || p.z < best.p.z || (p.z === best.p.z && i < best.i)) best = { p, i }
  })
  return best ? best.p : null
}

// A new panel drawn just behind `behindId` and in front of everything that
// was behind it: the same z, and right before it in the list, so no other
// panel changes (a shape as the card behind a group). Added in front of
// everything when there is no such panel.
export function insertBehind(spec, part, panel, behindId) {
  return editPanels(spec, part, (panels) => {
    const i = panels.findIndex((p) => p.id === behindId)
    if (i < 0) return [...panels, panel]
    const out = panels.slice()
    out.splice(i, 0, { ...panel, z: panels[i].z })
    return out
  })
}

// Global knobs. On Day: spec.global. On a variant: its own global, created
// on the first edit as a full copy of Day's plus the change (so it no longer
// follows Day's).
export function editGlobal(spec, part, patch) {
  if (part === 'day') return same(spec.global, patch) ? spec : { ...spec, global: { ...spec.global, ...patch } }
  if (!hasPart(spec, part)) return spec
  const v = spec.variants[part]
  const own = isDict(v.global) ? v.global : null
  if (own && same(own, patch)) return spec
  return { ...spec, variants: { ...spec.variants, [part]: { ...v, global: { ...spec.global, ...(own || {}), ...patch } } } }
}

// A variant's own global dropped: it follows Day's again.
export function followDayGlobal(spec, part) {
  if (part === 'day' || !hasPart(spec, part) || !isDict(spec.variants[part].global)) return spec
  const v = { ...spec.variants[part] }
  delete v.global
  return { ...spec, variants: { ...spec.variants, [part]: v } }
}

export const setEveningFrom = (spec, hour) => (spec.eveningFrom === hour ? spec : { ...spec, eveningFrom: hour })

// --- element styles (props.elements) ------------------------------------------------
//
// Sparse: a field at its default is left out, an element with nothing left
// goes, and so does an empty map, so an untouched element is simply absent.

function tidyStyle(style) {
  const out = {}
  for (const f of elementStyleFields()) {
    if (!Object.prototype.hasOwnProperty.call(style, f.key)) continue
    const v = style[f.key]
    if (v === undefined || v === null || v === f.default) continue
    out[f.key] = v
  }
  return out
}

function withElements(p, elements) {
  const props = { ...p.props }
  if (elements && Object.keys(elements).length) props.elements = elements
  else delete props.elements
  return deepEqual(props, p.props) ? p : { ...p, props }
}

// One element's style changed by `patch` ({ size: 1.2 }, { color: null }).
export const withElementStyle = (key, patch) => (p) => {
  const cur = isDict(p.props?.elements) ? p.props.elements : {}
  const style = tidyStyle({ ...(isDict(cur[key]) ? cur[key] : {}), ...patch })
  const next = { ...cur }
  if (Object.keys(style).length) next[key] = style
  else delete next[key]
  return withElements(p, next)
}

// Reset element: its style gone.
export const withoutElementStyle = (key) => (p) => {
  const cur = isDict(p.props?.elements) ? p.props.elements : null
  if (!cur || !(key in cur)) return p
  const next = { ...cur }
  delete next[key]
  return withElements(p, next)
}

// Every element style of the panel gone.
export const withoutElementStyles = () => (p) => withElements(p, null)

// --- box v2 props (a path: ['bg', 'color']) ----------------------------------------------

// null or undefined removes the value (an empty bg / border / title goes too);
// so does the field's default, except where the schema default is what a
// preset would not give (never, today: every default is "as designed").
export const withPropPath = (path, value, field) => (p) => {
  const drop = value === undefined || value === null || (field && value === field.default) || (field?.type === 'text' && value === '')
  const props = setPath(p.props, path, drop ? undefined : value)
  return deepEqual(props, p.props) ? p : { ...p, props }
}

// --- visibility rules (panel.when) ------------------------------------------------------

// when: null (or an empty rule) drops it: the panel always shows.
export const withWhen = (when) => (p) => {
  const empty = !isDict(when) || !Object.values(when).some((l) => Array.isArray(l) && l.length)
  if (empty) {
    if (!('when' in p)) return p
    const out = { ...p }
    delete out.when
    return out
  }
  return deepEqual(p.when, when) ? p : { ...p, when }
}

// --- copy and paste style -----------------------------------------------------------------
//
// A style: the universal props, the box v2 props, the element styles and the
// rule; the type's own knobs too, which only go onto a panel of the same
// type. Never the position, size, z, id, hidden or locked, and never content
// (a text block's text, an image's picture).

const CONTENT_KEYS = ['text', 'src']

export function styleOf(panel) {
  const pr = panel.props || {}
  const box = {}
  for (const top of boxTopsFor(panel.type)) if (pr[top] !== undefined) box[top] = cloneJson(pr[top])
  const universal = {}
  for (const k of UNIVERSAL_KEYS) if (pr[k] !== undefined) universal[k] = pr[k]
  const knobs = {}
  for (const f of knobFields(panel.type)) {
    if (UNIVERSAL_KEYS.includes(f.key) || CONTENT_KEYS.includes(f.key)) continue
    if (pr[f.key] !== undefined) knobs[f.key] = cloneJson(pr[f.key])
  }
  return {
    type: panel.type,
    id: panel.id,
    universal,
    box,
    elements: isDict(pr.elements) ? cloneJson(pr.elements) : null,
    elementKeys: elementList(panel.type).map((e) => e.key),
    knobs,
    when: isDict(panel.when) ? cloneJson(panel.when) : null,
  }
}

// The target takes the style. Elements: onto the same type the whole map;
// onto another type, every element key both types have takes the source's
// style (or loses its own), the target's other elements keep theirs.
export const withStyle = (style) => (p) => {
  const props = { ...p.props, ...style.universal }
  // Every box key the target takes (not a text block's own colour).
  for (const top of boxTopsFor(p.type)) {
    if (style.box[top] !== undefined) props[top] = cloneJson(style.box[top])
    else delete props[top]
  }
  let elements
  if (p.type === style.type) {
    elements = style.elements ? cloneJson(style.elements) : null
  } else {
    elements = isDict(p.props.elements) ? { ...p.props.elements } : {}
    const shared = elementList(p.type)
      .map((e) => e.key)
      .filter((k) => style.elementKeys.includes(k))
    for (const k of shared) {
      const st = style.elements?.[k] ? cleanElementStyle(style.elements[k]) : null
      if (st && Object.keys(st).length) elements[k] = st
      else delete elements[k]
    }
  }
  if (elements && Object.keys(elements).length) props.elements = elements
  else delete props.elements
  if (p.type === style.type) Object.assign(props, cloneJson(style.knobs))
  const out = { ...p, props }
  if (style.when) out.when = cloneJson(style.when)
  else delete out.when
  return deepEqual(out, p) ? p : out
}

// --- several panels: move, align, distribute, match -------------------------------------
//
// In whole canvas pixels, like every geometric edit; a field that does not
// move keeps its percent exactly (pxToPctKeeping). Locked panels stay put.

// Every panel of `ids`, moved by (dx, dy) canvas px from where `start` had
// them: start = { [id]: { pct, px } }.
export function movePanels(spec, part, start, dx, dy, canvas) {
  return mapPanels(spec, part, Object.keys(start), (p) => {
    const s = start[p.id]
    const rect = { x: s.px.x + dx, y: s.px.y + dy, w: s.px.w, h: s.px.h }
    return withBox(pxToPctKeeping(s.pct, s.px, rect, canvas))(p)
  })
}

// Their union in percent of the canvas, straight from their boxes (no
// whole-pixel step), so a card put behind a group sits exactly on its edges.
export function unionPct(list) {
  if (!list.length) return null
  const r3 = (v) => Math.round(v * 1000) / 1000 + 0
  const l = Math.min(...list.map((p) => p.x))
  const t = Math.min(...list.map((p) => p.y))
  return {
    x: l,
    y: t,
    w: r3(Math.max(...list.map((p) => p.x + p.w)) - l),
    h: r3(Math.max(...list.map((p) => p.y + p.h)) - t),
  }
}

// Their union, canvas px.
export function unionPx(list) {
  if (!list.length) return null
  const l = Math.min(...list.map((r) => r.x))
  const t = Math.min(...list.map((r) => r.y))
  const r = Math.max(...list.map((b) => b.x + b.w))
  const b = Math.max(...list.map((q) => q.y + q.h))
  return { x: l, y: t, w: r - l, h: b - t }
}

// kind: 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom', to the
// selection's bounds.
export function alignPanels(spec, part, ids, kind, canvas) {
  const panels = (partPanels(spec, part) || []).filter((p) => ids.includes(p.id))
  const px = Object.fromEntries(panels.map((p) => [p.id, pctToPxRound(p, canvas)]))
  const u = unionPx(Object.values(px))
  if (!u) return spec
  return mapPanels(spec, part, ids, (p) => {
    if (p.locked) return p
    const r = px[p.id]
    const n = { ...r }
    if (kind === 'left') n.x = u.x
    else if (kind === 'centre') n.x = Math.round(u.x + (u.w - r.w) / 2)
    else if (kind === 'right') n.x = u.x + u.w - r.w
    else if (kind === 'top') n.y = u.y
    else if (kind === 'middle') n.y = Math.round(u.y + (u.h - r.h) / 2)
    else if (kind === 'bottom') n.y = u.y + u.h - r.h
    return withBox(pxToPctKeeping(p, r, n, canvas))(p)
  })
}

// Equal gaps between the boxes along one axis ('x' | 'y'), the first and the
// last staying where they are (three or more).
export function distributePanels(spec, part, ids, axis, canvas) {
  const panels = (partPanels(spec, part) || []).filter((p) => ids.includes(p.id))
  if (panels.length < 3) return spec
  const pos = axis === 'x' ? 'x' : 'y'
  const size = axis === 'x' ? 'w' : 'h'
  const items = panels.map((p) => ({ p, r: pctToPxRound(p, canvas) })).sort((a, b) => a.r[pos] - b.r[pos] || a.r[size] - b.r[size])
  const first = items[0].r
  const last = items[items.length - 1].r
  const span = last[pos] + last[size] - first[pos]
  const total = items.reduce((n, it) => n + it.r[size], 0)
  const gap = (span - total) / (items.length - 1)
  const target = {}
  let at = first[pos]
  for (const it of items) {
    target[it.p.id] = Math.round(at)
    at += it.r[size] + gap
  }
  return mapPanels(spec, part, ids, (p) => {
    if (p.locked) return p
    const it = items.find((x) => x.p.id === p.id)
    const n = { ...it.r, [pos]: target[p.id] }
    return withBox(pxToPctKeeping(p, it.r, n, canvas))(p)
  })
}

// Every box takes the reference's width ('w') or height ('h'), keeping its
// own left or top edge, pulled back inside the canvas; never under its type's
// minimum (minPx(type) -> { w, h } canvas px).
export function matchPanels(spec, part, ids, refId, dim, canvas, minPx) {
  const list = partPanels(spec, part) || []
  const ref = list.find((p) => p.id === refId)
  if (!ref) return spec
  const want = pctToPxRound(ref, canvas)[dim]
  return mapPanels(spec, part, ids, (p) => {
    if (p.locked || p.id === refId) return p
    const r = pctToPxRound(p, canvas)
    const min = minPx(p.type)
    const n = { ...r }
    if (dim === 'w') {
      n.w = clamp(want, min.w, canvas.w)
      n.x = clamp(r.x, 0, canvas.w - n.w)
    } else {
      n.h = clamp(want, min.h, canvas.h)
      n.y = clamp(r.y, 0, canvas.h - n.h)
    }
    return withBox(pxToPctKeeping(p, r, n, canvas))(p)
  })
}
