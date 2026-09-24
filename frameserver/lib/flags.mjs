// flags.mjs - the photo-location correction queue ("this caption is wrong").
//
// The kitchen long-press flags a photo whose location caption is wrong; flags
// pile up here and get triaged on the Mac (code/scripts/flags-review.mjs,
// flags-apply.mjs). Port of GET /api/flags, _append_flag and _resolve_flags
// from pi/kiosk-server.py, same file format (a JSON list of
// { assetId, wrongCaption, ts, resolved }) and same responses:
//
//   GET  /api/flags[?unresolved=1]  the list (filtered to unresolved)
//   POST /api/flags                 { assetId, wrongCaption?, ts? } -> { ok, unresolved }
//   POST /api/flags/resolve         { assetIds: [] }               -> { ok, resolved: n }
//   POST /api/flags/import          [ flag, ... ]  -> { ok, total, unresolved, imported }
//
// /import is new: the one-time move of the Pi's queue to the hub. Merge by
// assetId: an incoming item replaces an existing one with the same assetId
// (in place), anything else is appended. Re-running it with the same list
// is therefore harmless, though it would reset `resolved` on an item that
// was resolved on the hub in the meantime.

import { isDict, readJsonFile, writeJsonFileAtomic } from './io.mjs'

const countUnresolved = (flags) => flags.filter((f) => !f?.resolved).length

// Python's utcnow().isoformat() + 'Z', at millisecond precision.
const utcNowIso = () => new Date().toISOString()

export function createFlags(file) {
  const read = () => {
    const v = readJsonFile(file, [])
    return Array.isArray(v) ? v : []
  }
  const write = (flags) => writeJsonFileAtomic(file, flags)

  return {
    list(unresolvedOnly) {
      const flags = read()
      return unresolvedOnly ? flags.filter((f) => !f?.resolved) : flags
    },

    // Deduped on assetId among UNRESOLVED flags, so the same photo pressed
    // twice refreshes its flag; a photo flagged again after a fix gets a new one.
    append(obj) {
      const assetId = isDict(obj) ? obj.assetId : undefined
      if (!assetId) return { status: 400, body: { ok: false, error: 'assetId required' } }
      const ts = obj.ts || utcNowIso()
      const flags = read()
      const existing = flags.find((f) => f?.assetId === assetId && !f.resolved)
      if (existing) {
        existing.ts = ts
        existing.wrongCaption = Object.hasOwn(obj, 'wrongCaption')
          ? obj.wrongCaption
          : Object.hasOwn(existing, 'wrongCaption') ? existing.wrongCaption : ''
      } else {
        flags.push({
          assetId,
          wrongCaption: Object.hasOwn(obj, 'wrongCaption') ? obj.wrongCaption : '',
          ts,
          resolved: false,
        })
      }
      write(flags)
      return { status: 200, body: { ok: true, unresolved: countUnresolved(flags) } }
    },

    // Mark assetIds resolved once their corrections are applied and deployed,
    // so they drop out of the triage list. Written even when nothing matched,
    // as the Python did.
    resolve(obj) {
      const ids = isDict(obj) ? obj.assetIds : undefined
      if (!Array.isArray(ids)) return { status: 400, body: { ok: false, error: 'assetIds must be a list' } }
      const idset = new Set(ids)
      const flags = read()
      let n = 0
      for (const f of flags) {
        if (idset.has(f?.assetId) && !f.resolved) {
          f.resolved = true
          n += 1
        }
      }
      write(flags)
      return { status: 200, body: { ok: true, resolved: n } }
    },

    import(incoming) {
      if (!Array.isArray(incoming)) {
        return { status: 400, body: { ok: false, error: 'expected a JSON list of flags' } }
      }
      const flags = read()
      let imported = 0
      for (const item of incoming) {
        if (!isDict(item) || !item.assetId) continue
        const flag = {
          assetId: item.assetId,
          wrongCaption: Object.hasOwn(item, 'wrongCaption') ? item.wrongCaption : '',
          ts: item.ts || utcNowIso(),
          resolved: !!item.resolved,
        }
        const at = flags.findIndex((f) => f?.assetId === flag.assetId)
        if (at === -1) flags.push(flag)
        else flags[at] = flag
        imported += 1
      }
      write(flags)
      return {
        status: 200,
        body: { ok: true, total: flags.length, unresolved: countUnresolved(flags), imported },
      }
    },
  }
}
