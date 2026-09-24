// env.mjs - the service root's .env, loaded into process.env at startup.
//
// The photo build has always read C:\Services\FrameServer\.env through
// `node --env-file` (IMMICH_URL, IMMICH_API_KEY, GOOGLE_API_KEY). Since the
// Entry board (docs/designs/entry-board.md) the server itself needs some of
// those keys: the Countdown Art sync talks to Immich, and
// GOOGLE_CALENDAR_KEY_FILE / GOOGLE_CALENDAR_FIXTURE can be set here. A tiny
// parser rather than --env-file on the service command line, so the nssm
// service definition on the NUC does not change and a missing .env is not
// fatal (--env-file refuses to start without one).
//
// Values are read exactly as Node's own --env-file parser reads them (checked
// against Node 22), so the photo build, which inherits this process's
// environment AND reads the same file with --env-file (where the environment
// wins), sees identical values:
//   KEY=value            blank lines, # comment lines and lines without = skip
//   export KEY=value     the "export " prefix is ignored
//   KEY=value # note     an unquoted value ends at the first #, then is trimmed
//   KEY="value"          quoted with " ' or ` : the value runs to the next same
//                        quote, across lines if need be; the rest of the line
//                        that closes it is ignored; in double quotes \n is a
//                        newline (no other escapes); an unclosed quote is
//                        read as an unquoted value, quote included
// CRLF line endings and a UTF-8 or UTF-16LE byte order mark are fine (the file
// lives on Windows). The last line for a key wins. A variable already in the
// environment (nssm, the shell) always wins: the file never overrides it.

import { readFileSync } from 'node:fs'

const KEY_RE = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/

const unquoted = (raw) => {
  const hash = raw.indexOf('#')
  return (hash === -1 ? raw : raw.slice(0, hash)).trim()
}

// .env text -> { KEY: value }.
export function parseEnv(text) {
  const src = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const out = {}
  let pos = 0
  while (pos < src.length) {
    let eol = src.indexOf('\n', pos)
    if (eol === -1) eol = src.length
    const m = KEY_RE.exec(src.slice(pos, eol))
    if (!m) {
      pos = eol + 1
      continue
    }
    let v = pos + m[0].length
    while (v < eol && (src[v] === ' ' || src[v] === '\t')) v++
    const q = src[v]
    const close = q === '"' || q === "'" || q === '`' ? src.indexOf(q, v + 1) : -1
    if (close !== -1) {
      const value = src.slice(v + 1, close)
      out[m[1]] = q === '"' ? value.replace(/\\n/g, '\n') : value
      const next = src.indexOf('\n', close)
      pos = next === -1 ? src.length : next + 1
    } else {
      out[m[1]] = unquoted(src.slice(v, eol))
      pos = eol + 1
    }
  }
  return out
}

function decode(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  return buf.toString('utf8')
}

// Load `path` into `env`. Returns what happened, by NAME only (never values),
// for the startup log: { path, found, loaded: [names set], kept: [names the
// environment already had], error }.
export function loadEnvFile(path, env = process.env) {
  let buf
  try {
    buf = readFileSync(path)
  } catch (e) {
    return { path, found: false, loaded: [], kept: [], error: e.code === 'ENOENT' ? null : e.code || e.message }
  }
  const loaded = []
  const kept = []
  for (const [key, value] of Object.entries(parseEnv(decode(buf)))) {
    if (env[key] !== undefined) {
      kept.push(key)
    } else {
      env[key] = value
      loaded.push(key)
    }
  }
  return { path, found: true, loaded, kept, error: null }
}
