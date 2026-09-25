// io.test.mjs - small file and HTTP helpers shared by the hub's modules.
//
// fetchWithTimeout is tested against a stubbed global.fetch (swapped back in
// `after`), never a real socket: this exercises the module's own timeout and
// error-shaping logic, not the network. File tests use fs.mkdtemp and clean
// up afterwards.

import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readJsonFile, writeJsonFileAtomic, isDict, fetchWithTimeout } from '../lib/io.mjs'

describe('isDict', () => {
  it('is true only for a plain object, false for arrays/null/primitives', () => {
    assert.equal(isDict({}), true)
    assert.equal(isDict({ a: 1 }), true)
    assert.equal(isDict([]), false)
    assert.equal(isDict(null), false)
    assert.equal(isDict('x'), false)
    assert.equal(isDict(42), false)
    assert.equal(isDict(undefined), false)
    assert.equal(isDict(true), false)
  })
})

describe('readJsonFile / writeJsonFileAtomic', () => {
  it('round-trips a value written atomically, and never leaves a .tmp file behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'io-test-'))
    const f = join(dir, 'data.json')
    try {
      assert.deepEqual(readJsonFile(f, { fallback: true }), { fallback: true })
      writeJsonFileAtomic(f, { a: 1, b: [1, 2, 3] })
      assert.deepEqual(readJsonFile(f, null), { a: 1, b: [1, 2, 3] })
      assert.deepEqual(await readdir(dir), ['data.json'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writes compact JSON by default, and pretty (indented) when asked', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'io-test-'))
    const f = join(dir, 'data.json')
    try {
      writeJsonFileAtomic(f, { a: 1 })
      assert.ok(!(await readFile(f, 'utf8')).includes('\n'))
      writeJsonFileAtomic(f, { a: 1 }, true)
      assert.ok((await readFile(f, 'utf8')).includes('\n  "a"'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a missing or corrupt file degrades to the fallback, never throws', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'io-test-'))
    const missing = join(dir, 'missing.json')
    const corrupt = join(dir, 'corrupt.json')
    try {
      assert.equal(readJsonFile(missing, 'fallback-value'), 'fallback-value')
      await writeFile(corrupt, '{not json')
      assert.equal(readJsonFile(corrupt, 'fallback-value'), 'fallback-value')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('fetchWithTimeout', () => {
  const realFetch = globalThis.fetch
  after(() => {
    globalThis.fetch = realFetch
  })

  it('resolves { res, body } for a normal response', async () => {
    globalThis.fetch = async (url) => new Response(JSON.stringify({ url: String(url) }), { status: 200 })
    const { res, body } = await fetchWithTimeout('http://example.invalid/api', { timeoutMs: 1000 })
    assert.equal(res.status, 200)
    assert.equal(res.ok, true)
    assert.deepEqual(JSON.parse(body.toString('utf8')), { url: 'http://example.invalid/api' })
  })

  it('aborts and rejects with a readable message once the timeout elapses', async () => {
    globalThis.fetch = (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason))
      })
    await assert.rejects(fetchWithTimeout('http://example.invalid/hangs', { timeoutMs: 20 }), /timed out after 0\.02s/)
  })

  it('unwraps a hidden ECONNREFUSED-style cause.code from a generic "fetch failed" TypeError', async () => {
    globalThis.fetch = async () => {
      const e = new TypeError('fetch failed')
      e.cause = { code: 'ECONNREFUSED' }
      throw e
    }
    await assert.rejects(fetchWithTimeout('http://example.invalid/x'), /^Error: ECONNREFUSED$/)
  })

  it('prefers cause.message when present', async () => {
    globalThis.fetch = async () => {
      const e = new TypeError('fetch failed')
      e.cause = { message: 'getaddrinfo ENOTFOUND' }
      throw e
    }
    await assert.rejects(fetchWithTimeout('http://example.invalid/x'), /getaddrinfo ENOTFOUND/)
  })

  it('joins cause.errors[] messages when there is no top-level cause.message', async () => {
    globalThis.fetch = async () => {
      const e = new TypeError('fetch failed')
      e.cause = { errors: [{ message: 'e1' }, { message: 'e2' }] }
      throw e
    }
    await assert.rejects(fetchWithTimeout('http://example.invalid/x'), /e1; e2/)
  })

  it('malformed input: a non-Error throw is still surfaced as an Error', async () => {
    globalThis.fetch = async () => {
      throw 'just a string'
    }
    await assert.rejects(fetchWithTimeout('http://example.invalid/x'), (e) => e instanceof Error && e.message === 'just a string')
  })
})
