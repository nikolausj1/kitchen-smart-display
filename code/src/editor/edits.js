// edits.js - pure spec edits, the recipes Editor.jsx hands to
// actions.update(recipe). A recipe is (spec, part) => spec, where part is the
// day part being edited ('day' = the base panels and global, else a variant);
// the reducer passes the part it holds, so an edit always lands in the tab it
// was made in. Returning the same spec object means "nothing changed".

import { hasPart, isDict, partPanels } from './spec.js'

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
  return editPanels(spec, part, (panels) => {
    let changed = false
    const out = panels.map((p) => {
      if (p.id !== id) return p
      const n = fn(p)
      if (n !== p) changed = true
      return n
    })
    return changed ? out : panels
  })
}

export const removePanel = (spec, part, id) =>
  editPanels(spec, part, (panels) => (panels.some((p) => p.id === id) ? panels.filter((p) => p.id !== id) : panels))

export const addPanel = (spec, part, panel) => editPanels(spec, part, (panels) => [...panels, panel])

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
