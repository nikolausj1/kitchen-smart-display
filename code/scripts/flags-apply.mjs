#!/usr/bin/env node
// Apply photo-location corrections.
//
// Reads the filled review export (from _inbox/ by default), appends one
// custom-places.json bubble per correction, and prints the exact push +
// refresh + resolve commands to finish. We deliberately do NOT auto-push or
// resolve flags here, so you can eyeball custom-places.json and only resolve
// the flags after a successful refresh.
//
// Since the 2026-08 migration this hand-off spans TWO hosts:
//   FrameServer (nuc.local:8095)  owns custom-places.json and the rebuild
//   kitchen Pi  (smartdisplay)    still owns the flag queue (/api/flags)
// See docs/designs/photo-refresh-automation.md.
//
// Usage:
//   node scripts/flags-apply.mjs [path-to-flag-corrections.json]
//   (defaults to the newest _inbox/flag-corrections*.json)
//   Override target file with KIOSK_CUSTOM_PLACES_PATH.

import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..')
const INBOX = join(PROJECT_ROOT, '_inbox')
const CUSTOM_PLACES =
  process.env.KIOSK_CUSTOM_PLACES_PATH || join(PROJECT_ROOT, 'custom-places.json')
// The Pi still holds the flag queue; FrameServer holds the build inputs.
const PI_BASE = (process.env.PI_BASE || 'http://smartdisplay.local:8080').replace(/\/+$/, '')
const HUB_BASE = (process.env.HUB_BASE || 'http://nuc.local:8095').replace(/\/+$/, '')
const HUB_SSH = process.env.HUB_SSH || 'micro@nuc.local'
const HUB_DIR = process.env.HUB_DIR || 'C:/Services/FrameServer'

// Default bubble radius (meters) by category. A property with grounds wants a
// larger bubble than a single restaurant.
const RADIUS_BY_CATEGORY = {
  home: 40, friend: 40, family: 40, restaurant: 50, venue: 50,
  park: 150, school: 80, work: 120, other: 40,
}

async function findInput(argPath) {
  if (argPath) return resolve(argPath)
  if (!existsSync(INBOX)) return null
  const files = (await readdir(INBOX)).filter((f) => /^flag-corrections.*\.json$/i.test(f))
  if (!files.length) return null
  files.sort()
  return join(INBOX, files[files.length - 1])
}

async function main() {
  const input = await findInput(process.argv[2])
  if (!input || !existsSync(input)) {
    console.error('! No corrections file. Pass a path or drop flag-corrections*.json into _inbox/.')
    process.exit(1)
  }

  let items
  try {
    items = JSON.parse(await readFile(input, 'utf8'))
  } catch (e) {
    console.error(`! could not parse ${input}: ${e.message}`)
    process.exit(1)
  }

  const corrections = (Array.isArray(items) ? items : []).filter(
    (c) => c && typeof c.correctLabel === 'string' && c.correctLabel.trim() &&
      typeof c.lat === 'number' && typeof c.lon === 'number'
  )
  if (!corrections.length) {
    console.log('No usable corrections (each needs correctLabel + numeric lat/lon). Nothing to do.')
    return
  }

  let doc = { places: [] }
  if (existsSync(CUSTOM_PLACES)) {
    try {
      doc = JSON.parse(await readFile(CUSTOM_PLACES, 'utf8'))
    } catch {
      doc = { places: [] }
    }
  }
  if (!Array.isArray(doc.places)) doc.places = []

  const applied = []
  for (const c of corrections) {
    const cat = (c.category || 'other').toLowerCase()
    const radius_m = RADIUS_BY_CATEGORY[cat] || 40
    const entry = { name: c.correctLabel.trim(), lat: c.lat, lon: c.lon, radius_m, category: cat }
    doc.places.push(entry)
    applied.push({ assetId: c.assetId, ...entry })
  }

  await writeFile(CUSTOM_PLACES, JSON.stringify(doc, null, 2) + '\n')

  console.log(`Added ${applied.length} entr${applied.length === 1 ? 'y' : 'ies'} to ${CUSTOM_PLACES}:`)
  for (const a of applied) {
    console.log(`  - "${a.name}"  (${a.lat.toFixed(5)},${a.lon.toFixed(5)}  r=${a.radius_m}m  ${a.category})`)
  }
  const ids = applied.map((a) => a.assetId).filter(Boolean)
  console.log('\nNext steps (push the corrections to FrameServer, let it rebuild, then resolve')
  console.log('the flags on the Pi, which still owns the flag queue):')
  console.log(`  scp '${CUSTOM_PLACES}' ${HUB_SSH}:${HUB_DIR}/custom-places.json`)
  console.log(`  curl -s -X POST ${HUB_BASE}/api/photos/refresh`)
  console.log(`  curl -s ${HUB_BASE}/api/photos/refresh/status   # wait for running:false, ok:true`)
  console.log(`  curl -s -X POST -H 'Content-Type: application/json' -d '${JSON.stringify({ assetIds: ids })}' ${PI_BASE}/api/flags/resolve`)
}

main()
