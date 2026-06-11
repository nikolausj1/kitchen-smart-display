#!/usr/bin/env node
// Diff the Immich "Art *" albums against art-metadata.json.
//
// The art-albums feature (docs/designs/art-albums.md) joins curated metadata
// to art photos by originalFileName at manifest-build time. This script keeps
// the curation honest: it lists every image in every album whose name starts
// with "Art" and reports
//   - missing:  in Immich but not curated (build would warn + show no placard)
//   - orphaned: curated but no longer in Immich (harmless, but stale)
//
// Filenames are NFC-normalized on both sides: macOS uploads arrive in Immich
// NFD-decomposed ("e" + combining accent), and JSON authored here is NFC.
//
// Usage:
//   node --env-file=.env scripts/art-metadata-check.mjs          # human report
//   node --env-file=.env scripts/art-metadata-check.mjs --json   # missing list as JSON
//
// Exit code 1 if any entries are missing (suitable as a deploy gate).

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import { listAlbums, listAlbumAssets } from './lib/immich.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..')
const ART_METADATA_PATH =
  process.env.ART_METADATA_PATH || join(PROJECT_ROOT, 'art-metadata.json')

const immichUrl = (process.env.IMMICH_URL || '').replace(/\/+$/, '')
const immichKey = process.env.IMMICH_API_KEY || ''
if (!immichUrl || !immichKey) {
  console.error('IMMICH_URL + IMMICH_API_KEY required (node --env-file=.env ...)')
  process.exit(2)
}

const asJson = process.argv.includes('--json')
const nfc = (s) => s.normalize('NFC')

let curated = new Set()
if (existsSync(ART_METADATA_PATH)) {
  const doc = JSON.parse(await readFile(ART_METADATA_PATH, 'utf8'))
  curated = new Set(Object.keys(doc.pieces || {}).map(nfc))
} else if (!asJson) {
  console.warn(`! ${ART_METADATA_PATH} not found - treating all pieces as missing`)
}

const albums = await listAlbums({ baseUrl: immichUrl, apiKey: immichKey })
const artAlbums = albums.filter((a) => /^Art\b/.test(a.name))

const inImmich = new Set()
for (const album of artAlbums) {
  const assets = await listAlbumAssets({
    baseUrl: immichUrl, apiKey: immichKey, albumId: album.id,
  })
  for (const a of assets) {
    if (a.type !== 'IMAGE' || a.isTrashed) continue
    inImmich.add(nfc(a.originalFileName || ''))
  }
}

const missing = [...inImmich].filter((n) => !curated.has(n)).sort()
const orphaned = [...curated].filter((n) => !inImmich.has(n)).sort()

if (asJson) {
  console.log(JSON.stringify({ missing, orphaned }, null, 2))
} else {
  console.log(`Art albums: ${artAlbums.map((a) => a.name).join(', ') || '(none)'}`)
  console.log(`Pieces in Immich: ${inImmich.size}   curated: ${curated.size}`)
  if (missing.length) {
    console.log(`\nMISSING from art-metadata.json (${missing.length}):`)
    for (const n of missing) console.log(`  - ${n}`)
  }
  if (orphaned.length) {
    console.log(`\nORPHANED in art-metadata.json (${orphaned.length}):`)
    for (const n of orphaned) console.log(`  - ${n}`)
  }
  if (!missing.length && !orphaned.length) console.log('\nClean: curation matches Immich exactly.')
}

process.exit(missing.length ? 1 : 0)
