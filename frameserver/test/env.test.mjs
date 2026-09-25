// env.test.mjs - the service root's .env parser (mirrors Node's --env-file).
//
// See lib/env.mjs's header for the exact grammar this checks: comments,
// blank lines, the "export " prefix, quoting with " ' `, and the rule that
// a variable already in the environment always wins over the file.

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv, loadEnvFile } from '../lib/env.mjs'

describe('parseEnv', () => {
  it('parses a simple KEY=value line', () => {
    assert.deepEqual(parseEnv('KEY=value\n'), { KEY: 'value' })
  })

  it('skips blank lines and # comment lines', () => {
    assert.deepEqual(parseEnv('\n# comment\nKEY=value\n\n# another\nKEY2=value2\n'), { KEY: 'value', KEY2: 'value2' })
  })

  it('skips lines with no "="', () => {
    assert.deepEqual(parseEnv('noequalshere\nKEY=value\n'), { KEY: 'value' })
  })

  it('ignores an "export " prefix', () => {
    assert.deepEqual(parseEnv('export KEY=value\n'), { KEY: 'value' })
  })

  it('ends an unquoted value at the first # and trims it', () => {
    assert.deepEqual(parseEnv('KEY=value # a comment\n'), { KEY: 'value' })
    assert.deepEqual(parseEnv('KEY=  spaced value  \n'), { KEY: 'spaced value' })
  })

  it('reads double, single, and backtick quoted values', () => {
    assert.deepEqual(parseEnv('KEY="quoted value"\n'), { KEY: 'quoted value' })
    assert.deepEqual(parseEnv("KEY='single quoted'\n"), { KEY: 'single quoted' })
    assert.deepEqual(parseEnv('KEY=`backtick`\n'), { KEY: 'backtick' })
  })

  it('turns \\n into a real newline only inside double quotes', () => {
    assert.deepEqual(parseEnv('KEY="line1\\nline2"\n'), { KEY: 'line1\nline2' })
    assert.deepEqual(parseEnv("KEY='line1\\nline2'\n"), { KEY: 'line1\\nline2' })
  })

  it('lets a quoted value span real newlines, and ignores the rest of the closing line', () => {
    const out = parseEnv('KEY="multi\nline\nvalue" trailing ignored\nKEY2=after\n')
    assert.deepEqual(out, { KEY: 'multi\nline\nvalue', KEY2: 'after' })
  })

  it('reads an unclosed quote as an unquoted value, quote included', () => {
    const out = parseEnv('KEY="unclosed\nKEY2=after\n')
    assert.deepEqual(out, { KEY: '"unclosed', KEY2: 'after' })
  })

  it('splits on the first "=" only, so later "=" stay in the value', () => {
    assert.deepEqual(parseEnv('KEY=a=b=c\n'), { KEY: 'a=b=c' })
  })

  it('allows leading whitespace before the key', () => {
    assert.deepEqual(parseEnv('  KEY=leadingwhitespace\n'), { KEY: 'leadingwhitespace' })
  })

  it('the last line for a repeated key wins', () => {
    assert.deepEqual(parseEnv('KEY=first\nKEY=second\n'), { KEY: 'second' })
  })

  it('handles CRLF line endings and a missing trailing newline', () => {
    assert.deepEqual(parseEnv('KEY=value\r\nKEY2=value2\r\n'), { KEY: 'value', KEY2: 'value2' })
    assert.deepEqual(parseEnv('KEY=value'), { KEY: 'value' })
  })

  it('strips a leading UTF-8 BOM', () => {
    assert.deepEqual(parseEnv('﻿KEY=bomvalue\n'), { KEY: 'bomvalue' })
  })

  it('malformed input: an empty file parses to an empty object', () => {
    assert.deepEqual(parseEnv(''), {})
  })
})

describe('loadEnvFile', () => {
  let dir
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'env-test-'))
  })
  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('loads unset keys and reports which ones, without overwriting an existing env var', async () => {
    const p = join(dir, 'a.env')
    await writeFile(p, 'FOO=fromfile\nBAR=alsofromfile\n')
    const env = { FOO: 'preexisting' }
    const result = loadEnvFile(p, env)
    assert.deepEqual(result, { path: p, found: true, loaded: ['BAR'], kept: ['FOO'], error: null })
    assert.deepEqual(env, { FOO: 'preexisting', BAR: 'alsofromfile' })
  })

  it('a missing file is found:false with no error (not fatal)', () => {
    const p = join(dir, 'missing.env')
    assert.deepEqual(loadEnvFile(p, {}), { path: p, found: false, loaded: [], kept: [], error: null })
  })

  it('decodes a UTF-16LE file with a BOM', async () => {
    const p = join(dir, 'utf16.env')
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('KEY=utf16value\r\n', 'utf16le')])
    await writeFile(p, buf)
    const env = {}
    const result = loadEnvFile(p, env)
    assert.deepEqual(result.loaded, ['KEY'])
    assert.deepEqual(env, { KEY: 'utf16value' })
  })

  it('reports a non-ENOENT read error by code, and never throws', async () => {
    const result = loadEnvFile(dir, {}) // a directory, not a file
    assert.equal(result.found, false)
    assert.equal(result.error, 'EISDIR')
  })
})
