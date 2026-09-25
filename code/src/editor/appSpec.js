// appSpec.js - the one place the editor uses the app's own layout module
// (views/TodayLayouts/layoutSpec.js, Contract v2), bundled with the editor:
//
//   readSpec(raw, layoutId)     a stored or received spec as the editor holds
//                               it: the editor's clamps, then the app's
//                               normaliser with that layout's defaults, so
//                               every global and knob has its value (what the
//                               board draws is what the inspector shows)
//   finalSpec(spec, layoutId)   the same as the LAST pass before Save or Copy,
//                               so what is stored is exactly what the board
//                               renders
//   sameLayout(a, b, layoutId)  "would the screen draw the same thing?"
//   withVariant / withoutVariant  day-part variants, the app's own helpers
//   newPanel(type, layoutId, z) a functional panel for "Add panel": that
//                               layout's default box and props for the type,
//                               or the type's own starting box
//
// The editor's spec.js keeps its own copy of the normaliser for editing-time
// clamps; it must write a valid spec whatever app build the iframe shows.

import {
  newPanel as appNewPanel,
  normalizeSpec as appNormalizeSpec,
  withVariant as appWithVariant,
  withoutVariant as appWithoutVariant,
} from '../views/TodayLayouts/layoutSpec.js'
import { globalFields } from './schema.js'
import { hasPart, normalizeSpec } from './spec.js'
import { deepEqual, isDict } from './util.js'

const editorNormalize = (spec) => normalizeSpec(spec, { globalFields: globalFields() })

function appNormalize(spec, layoutId) {
  try {
    return appNormalizeSpec(spec, { defaultSpec: null, layoutId }) || null
  } catch {
    return null
  }
}

// null for "no spec" (the built-in default in the registry).
export function readSpec(raw, layoutId) {
  const mine = editorNormalize(raw)
  if (!mine) return null
  return appNormalize(mine, layoutId) || mine
}

export const finalSpec = readSpec

// canvas is informational and version is the writer's, so neither counts.
function canonical(spec, layoutId) {
  const n = readSpec(spec, layoutId)
  return n ? { ...n, canvas: null, version: null } : null
}

export function sameLayout(a, b, layoutId) {
  if (!a || !b) return a === b
  return deepEqual(canonical(a, layoutId), canonical(b, layoutId))
}

// Morning (evening, weekend) as a copy of the Day layout. The variant has no
// global of its own until one is edited, so it follows Day's.
export function withVariant(spec, part) {
  if (!spec || part === 'day' || hasPart(spec, part)) return spec
  const out = appWithVariant(spec, part)
  return isDict(out) && hasPart(out, part) ? out : spec
}

// The variant gone: that part shows the Day layout again.
export function withoutVariant(spec, part) {
  if (!spec || part === 'day' || !hasPart(spec, part)) return spec
  const out = appWithoutVariant(spec, part)
  return isDict(out) && Array.isArray(out.panels) && !hasPart(out, part) ? out : spec
}

// A functional panel for "Add panel", in front (z), or null.
export function newPanel(type, layoutId, z) {
  const p = appNewPanel(type, { z }, { layoutId })
  return isDict(p) && p.id === type ? p : null
}
