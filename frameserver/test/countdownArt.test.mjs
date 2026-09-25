// countdownArt.test.mjs - keyword derivation for the "Countdown Art" mirror.
//
// createCountdownArt() itself is a stateful factory that talks to Immich over
// the network and writes files into a synced directory; it is intentionally
// NOT exercised here (no network, per the test-suite rules). This file covers
// its pure building blocks: the keyword list built from a file name and an
// Immich description, and the per-asset -> index-entry mapping (artEntry),
// which only inspects the asset object it is given.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { artKeywords, artEntry, artUrl, ART_EXTS } from '../lib/countdownArt.mjs'

const UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('artKeywords', () => {
  it('includes the whole name, its underscore/dash/space-separated parts, and description words', () => {
    assert.deepEqual(
      artKeywords('mark_kim', 'A photo of Mark and Kim, at the lake!'),
      ['mark_kim', 'mark', 'kim', 'photo', 'of', 'and', 'at', 'the', 'lake'],
    )
  })

  it('drops single-character words (from the name parts or the description)', () => {
    assert.deepEqual(artKeywords('x', 'x y a bb'), ['bb'])
  })

  it('dedupes repeated words', () => {
    const out = artKeywords('pumpkin', 'pumpkin pumpkin PUMPKIN')
    assert.deepEqual(out, ['pumpkin'])
  })

  it('handles an empty/null description', () => {
    assert.deepEqual(artKeywords('pumpkin', ''), ['pumpkin'])
    assert.deepEqual(artKeywords('pumpkin', null), ['pumpkin'])
  })

  it('lowercases everything and trims edge punctuation from description words', () => {
    const out = artKeywords('cabin', 'Lake, Cabin! (fun times)')
    assert.ok(out.includes('lake'))
    assert.ok(out.includes('cabin'))
    assert.ok(out.includes('fun'))
    assert.ok(out.includes('times'))
    assert.ok(!out.includes('(fun'))
  })
})

describe('artEntry', () => {
  it('builds an index entry from a normal image asset', () => {
    const entry = artEntry({
      id: UUID,
      originalFileName: 'Pumpkin1.png',
      type: 'IMAGE',
      exifInfo: { description: 'halloween, fall', fileSizeInByte: 12345 },
      updatedAt: '2026-01-01T00:00:00Z',
      checksum: 'abc123',
    })
    assert.deepEqual(entry, {
      id: UUID,
      file: `${UUID}.png`,
      name: 'pumpkin',
      keywords: ['pumpkin', 'halloween', 'fall'],
      updatedAt: '2026-01-01T00:00:00Z',
      checksum: 'abc123',
      bytes: 12345,
    })
  })

  it('skips an asset without a usable (UUID) id', () => {
    assert.deepEqual(artEntry({ id: 'not-a-uuid' }), { skip: 'an asset without a usable id' })
    assert.deepEqual(artEntry('nope'), { skip: 'an asset without a usable id' })
    assert.deepEqual(artEntry(null), { skip: 'an asset without a usable id' })
  })

  it('skips a non-IMAGE asset (e.g. video)', () => {
    const entry = artEntry({ id: UUID, originalFileName: 'clip.mp4', type: 'VIDEO' })
    assert.deepEqual(entry, { skip: 'clip.mp4 (video)' })
  })

  it('skips a trashed asset', () => {
    const entry = artEntry({ id: UUID, originalFileName: 'x.png', isTrashed: true })
    assert.deepEqual(entry, { skip: 'x.png (in the trash)' })
  })

  it('skips a file type a browser cannot draw (e.g. HEIC)', () => {
    const entry = artEntry({ id: UUID, originalFileName: 'x.heic' })
    assert.equal(entry.skip, 'x.heic (.heic: not drawable in a browser)')
  })

  it('falls back to the MIME type for the extension when the file name has none', () => {
    const entry = artEntry({ id: UUID, originalFileName: 'noext', originalMimeType: 'image/webp' })
    assert.equal(entry.file, `${UUID}.webp`)
  })

  it('every extension it accepts is in the documented ART_EXTS set', () => {
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']) {
      assert.ok(ART_EXTS.has(ext))
    }
  })
})

describe('artUrl', () => {
  it('URL-encodes the file name under /countdown-art/', () => {
    assert.equal(artUrl('some file (1).png'), '/countdown-art/some%20file%20(1).png')
  })
})
