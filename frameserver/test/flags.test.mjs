// flags.test.mjs - the photo-location correction queue (createFlags).
//
// createFlags(file) only touches the filesystem (readJsonFile/
// writeJsonFileAtomic from io.mjs), never the network, so it is exercised
// directly against a throwaway file in the OS temp dir per the test-suite
// rules. Every call passes an explicit `ts` so results stay deterministic.

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFlags } from '../lib/flags.mjs'

describe('createFlags', () => {
  let dir, flags
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'flags-test-'))
    flags = createFlags(join(dir, 'flags.json'))
  })
  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('list() on a file that does not exist yet is an empty list', () => {
    assert.deepEqual(flags.list(), [])
  })

  it('append() requires an assetId', () => {
    assert.deepEqual(flags.append({}), { status: 400, body: { ok: false, error: 'assetId required' } })
  })

  it('append() adds a new flag, defaulting wrongCaption to ""', () => {
    assert.deepEqual(flags.append({ assetId: 'a1', wrongCaption: 'Paris', ts: '2026-01-01T00:00:00.000Z' }), { status: 200, body: { ok: true, unresolved: 1 } })
    assert.deepEqual(flags.append({ assetId: 'a2', ts: '2026-01-01T00:00:00.000Z' }), { status: 200, body: { ok: true, unresolved: 2 } })
    assert.deepEqual(flags.list(), [
      { assetId: 'a1', wrongCaption: 'Paris', ts: '2026-01-01T00:00:00.000Z', resolved: false },
      { assetId: 'a2', wrongCaption: '', ts: '2026-01-01T00:00:00.000Z', resolved: false },
    ])
  })

  it('append() on an existing UNRESOLVED assetId refreshes it in place instead of duplicating', () => {
    const result = flags.append({ assetId: 'a1', ts: '2026-01-02T00:00:00.000Z' })
    assert.deepEqual(result, { status: 200, body: { ok: true, unresolved: 2 } }) // still 2, not 3
    const a1 = flags.list().find((f) => f.assetId === 'a1')
    assert.equal(a1.ts, '2026-01-02T00:00:00.000Z')
    assert.equal(a1.wrongCaption, 'Paris') // kept, since this append omitted wrongCaption
  })

  it('resolve() marks matching unresolved flags, ignores unknown ids, and always writes', () => {
    assert.deepEqual(flags.resolve({ assetIds: ['a1', 'does-not-exist'] }), { status: 200, body: { ok: true, resolved: 1 } })
    assert.deepEqual(flags.list(true), [{ assetId: 'a2', wrongCaption: '', ts: '2026-01-01T00:00:00.000Z', resolved: false }])
  })

  it('resolve() requires assetIds to be an array', () => {
    assert.deepEqual(flags.resolve({ assetIds: 'not-an-array' }), { status: 400, body: { ok: false, error: 'assetIds must be a list' } })
  })

  it('append() on a photo flagged again after being resolved creates a fresh entry', () => {
    const result = flags.append({ assetId: 'a1', ts: '2026-01-03T00:00:00.000Z' })
    assert.deepEqual(result, { status: 200, body: { ok: true, unresolved: 2 } })
    const a1s = flags.list().filter((f) => f.assetId === 'a1')
    assert.equal(a1s.length, 2)
    assert.equal(a1s[0].resolved, true) // the original stays resolved
    assert.equal(a1s[1].resolved, false) // the new one is not
  })

  it('import() requires a JSON list', () => {
    assert.deepEqual(flags.import('nope'), { status: 400, body: { ok: false, error: 'expected a JSON list of flags' } })
  })

  it('import() replaces an existing assetId in place and appends new ones, skipping junk entries', () => {
    const result = flags.import([
      { assetId: 'a2', wrongCaption: 'Updated', ts: '2026-01-05T00:00:00.000Z', resolved: true },
      { assetId: 'a3', ts: '2026-01-04T00:00:00.000Z' },
      { notAnAssetId: true },
    ])
    assert.deepEqual(result, { status: 200, body: { ok: true, total: 4, unresolved: 2, imported: 2 } })
    const a2 = flags.list().find((f) => f.assetId === 'a2')
    assert.deepEqual(a2, { assetId: 'a2', wrongCaption: 'Updated', ts: '2026-01-05T00:00:00.000Z', resolved: true })
  })

  it('re-running the same import is harmless (idempotent replace-by-assetId)', () => {
    const before = flags.list()
    const result = flags.import([{ assetId: 'a3', ts: '2026-01-04T00:00:00.000Z', resolved: false }])
    assert.equal(result.body.imported, 1)
    assert.deepEqual(flags.list(), before)
  })
})
