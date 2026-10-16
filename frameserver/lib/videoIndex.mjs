// videoIndex.mjs - the Music Videos collection's index: one entry per song,
// kept on the hub's own disk and written through to the NAS folder.
//
// The collection itself lives in MUSIC_VIDEOS_DIR (a UNC path on the NUC):
//
//   cache/<ArtistSafe>/<Artist> - <Title> [<videoId>].mp4   evictable
//   cache/<ArtistSafe>/<Artist> - <Title> [<videoId>].jpg   thumbnail
//   overrides/**/<Artist> - <Title>.mp4                      never evicted, always wins
//   index.json                                               write-through copy
//   README.txt                                               the naming rule, written once
//
// index.json is { version: 1, entries: { [songKey]: entry } }:
//
//   { key, artist, title, album, durationMs,        as first seen from Sonos
//     status: 'ready' | 'none',                     none = searched, no acceptable video
//     source: 'cache' | 'override' | null,
//     videoId, videoTitle, channel, videoDurationMs,  null for none / override
//     file, thumb,                                  relative to the folder, forward slashes
//     bytes, plays, lastPlayedAt, resolvedAt, missAt,  times are epoch ms
//     denied: [videoId, ...], pinned }              pinned = a dashboard pick
//
// The local copy (VIDEO_LOCAL_DIR/index.json) is the one the hub reads, so a
// NAS hiccup never takes Now Playing down; the NAS copy is only read when the
// local one is missing (a rebuilt hub). Every mutation writes the local copy
// atomically at once, then the NAS copy in the background: an async write
// (a hung SMB share must never block the event loop), one at a time, coalesced
// (a burst of changes is one write). A NAS failure is kept in lastWriteError
// and never throws; the next change retries.
//
// Eviction (evictToCap) counts only cache entries and removes the least
// recently played first (an entry never played counts from when it was
// fetched). Overrides and pinned entries are never removed; nor are keys the
// caller protects (what is playing and what is next).

import { mkdirSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { isDict, readJsonFile, writeJsonFileAtomic } from './io.mjs'
import { songKey } from './videoMatch.mjs'

export const INDEX_VERSION = 1
export const OVERRIDE_EXTS = new Set(['.mp4', '.mov', '.m4v'])

export const README_TEXT = `Music Videos (Smart Display)
============================

cache/       Videos the hub fetched and keeps for next time. Safe to delete;
             the hub removes the least recently played when the folder passes
             its size cap (set on the hub dashboard, Videos page).
overrides/   Your own files. Never deleted, and they win over anything the hub
             would fetch. Put them here, flat or inside any folders, named
             exactly:

                 Artist - Title.mp4

             (.mov and .m4v work too). The match ignores case, accents,
             punctuation and "feat." / "Remastered" tails, so
             "Daft Punk - Get Lucky.mp4" matches "Get Lucky (feat. Pharrell)".
index.json   The hub's list of matches. Written by the hub; leave it alone.
`

// A fresh entry for a song first seen from Sonos.
export function newEntry({ key, artist = '', title = '', album = '', durationMs = 0 } = {}) {
  return {
    key,
    artist,
    title,
    album,
    durationMs,
    status: 'none',
    source: null,
    videoId: null,
    videoTitle: null,
    channel: null,
    videoDurationMs: null,
    file: null,
    thumb: null,
    bytes: 0,
    plays: 0,
    lastPlayedAt: null,
    resolvedAt: null,
    missAt: null,
    denied: [],
    pinned: false,
  }
}

const errMsg = (e) => String((e && e.message) || e)

export function createVideoIndex({ dir = null, localDir, now = () => Date.now() } = {}) {
  const localFile = join(localDir, 'index.json')
  const nasFile = dir ? join(dir, 'index.json') : null
  /** @type {Map<string, object>} */
  const entries = new Map()
  let lastWriteError = null
  let lastLocalError = null
  let nasDirty = false
  let nasBusy = null
  let localDirMade = false

  // A path under the folder from an index-relative one, or null when it would
  // leave the folder (a hand-edited index must not point at C:\Windows).
  function absPath(rel) {
    if (!dir || typeof rel !== 'string' || !rel) return null
    const root = resolve(dir)
    const full = resolve(root, ...rel.split('/'))
    return full !== root && full.startsWith(root + sep) ? full : null
  }

  function document() {
    return { version: INDEX_VERSION, entries: Object.fromEntries(entries) }
  }

  async function pumpNas() {
    try {
      while (nasDirty) {
        nasDirty = false
        try {
          const tmp = `${nasFile}.tmp`
          await writeFile(tmp, JSON.stringify(document(), null, 2))
          await rename(tmp, nasFile)
          lastWriteError = null
        } catch (e) {
          lastWriteError = errMsg(e)
        }
      }
    } finally {
      nasBusy = null
    }
  }

  // Local copy now, NAS copy in the background.
  function save() {
    try {
      if (!localDirMade) {
        mkdirSync(localDir, { recursive: true })
        localDirMade = true
      }
      writeJsonFileAtomic(localFile, document(), true)
      lastLocalError = null
    } catch (e) {
      lastLocalError = errMsg(e)
    }
    if (nasFile) {
      nasDirty = true
      if (!nasBusy) nasBusy = pumpNas()
    }
  }

  function adopt(doc) {
    entries.clear()
    const src = isDict(doc) && isDict(doc.entries) ? doc.entries : {}
    for (const [key, e] of Object.entries(src)) {
      if (!isDict(e)) continue
      entries.set(key, { ...newEntry({ key }), ...e, key, denied: Array.isArray(e.denied) ? e.denied : [] })
    }
  }

  // Files named by a removed entry. Only ever under cache/: an override or a
  // hand-edited path is left alone.
  async function deleteFiles(entry) {
    if (!entry || entry.source !== 'cache') return
    for (const rel of [entry.file, entry.thumb]) {
      if (typeof rel !== 'string' || !rel.startsWith('cache/')) continue
      const full = absPath(rel)
      if (!full) continue
      try {
        await unlink(full)
      } catch { /* already gone, or the share is down: the next clear sweeps it */ }
    }
  }

  const index = {
    absPath,
    get dir() { return dir },
    get localDir() { return localDir },
    get lastWriteError() { return lastWriteError },
    get lastLocalError() { return lastLocalError },

    // cache/ and overrides/ in the folder, a README.txt once, the hub's scratch
    // dir. Never throws: { ok, error }.
    async ensureLayout() {
      try {
        await mkdir(join(localDir, 'tmp'), { recursive: true })
      } catch (e) {
        return { ok: false, error: `local dir: ${errMsg(e)}` }
      }
      if (!dir) return { ok: true, error: null }
      try {
        await mkdir(join(dir, 'cache'), { recursive: true })
        await mkdir(join(dir, 'overrides'), { recursive: true })
        try {
          await writeFile(join(dir, 'README.txt'), README_TEXT, { flag: 'wx' })
        } catch (e) {
          if (e.code !== 'EEXIST') throw e
        }
        return { ok: true, error: null }
      } catch (e) {
        return { ok: false, error: errMsg(e) }
      }
    },

    // The local copy wins; the NAS copy is read only when the local one is
    // missing. Returns the entry count.
    async load() {
      const local = readJsonFile(localFile, null)
      if (isDict(local) && isDict(local.entries)) {
        adopt(local)
        return entries.size
      }
      if (nasFile) {
        try {
          adopt(JSON.parse(await readFile(nasFile, 'utf8')))
          if (entries.size) save()
        } catch { /* no NAS copy yet, or the share is down: start empty */ }
      }
      return entries.size
    },

    get: (key) => entries.get(key) ?? null,
    has: (key) => entries.has(key),
    list: () => [...entries.values()],
    get size() { return entries.size },

    // Replace an entry whole.
    set(key, entry) {
      const e = { ...newEntry({ key }), ...entry, key }
      entries.set(key, e)
      save()
      return e
    },

    // Merge fields into an entry, creating it from `info` (artist, title,
    // album, durationMs) when it is new.
    update(key, patch, info = null) {
      const cur = entries.get(key) ?? (info ? newEntry({ key, ...info }) : null)
      if (!cur) return null
      const e = { ...cur, ...patch, key }
      entries.set(key, e)
      save()
      return e
    },

    markPlayed(key) {
      const e = entries.get(key)
      if (!e) return null
      return index.update(key, { plays: (e.plays || 0) + 1, lastPlayedAt: now() })
    },

    // Searched and found nothing acceptable. The video fields are cleared; the
    // deny list and the play count stay.
    markMiss(key, info = null) {
      return index.update(key, {
        status: 'none', source: null, videoId: null, videoTitle: null, channel: null,
        videoDurationMs: null, file: null, thumb: null, bytes: 0, missAt: now(), pinned: false,
      }, info)
    },

    // Remember a rejected video id for this song.
    deny(key, videoId, info = null) {
      const cur = entries.get(key) ?? (info ? newEntry({ key, ...info }) : null)
      if (!cur) return null
      if (!videoId || cur.denied.includes(videoId)) return cur
      return index.update(key, { denied: [...cur.denied, videoId] }, info)
    },

    // Delete an entry and, for a cache entry, its files. Resolves the removed
    // entry, or null when there was none.
    async remove(key, { files = true } = {}) {
      const e = entries.get(key)
      if (!e) return null
      entries.delete(key)
      save()
      if (files) await deleteFiles(e)
      return e
    },

    // What the cache holds. Overrides are never counted.
    totalBytes() {
      let sum = 0
      for (const e of entries.values()) if (e.status === 'ready' && e.source === 'cache') sum += e.bytes || 0
      return sum
    },

    cacheCount() {
      let n = 0
      for (const e of entries.values()) if (e.status === 'ready' && e.source === 'cache') n++
      return n
    },

    // Remove least recently played cache entries (never overrides, pinned or
    // protected keys) until the cache fits capBytes. Resolves what it removed.
    async evictToCap(capBytes, { protect = new Set() } = {}) {
      const removed = []
      let total = index.totalBytes()
      if (!(capBytes >= 0) || total <= capBytes) return removed
      const recency = (e) => e.lastPlayedAt ?? e.resolvedAt ?? 0
      const order = [...entries.values()]
        .filter((e) => e.status === 'ready' && e.source === 'cache' && !e.pinned && !protect.has(e.key))
        .sort((a, b) => recency(a) - recency(b) || (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0))
      for (const e of order) {
        if (total <= capBytes) break
        total -= e.bytes || 0
        removed.push(await index.remove(e.key))
      }
      return removed.filter(Boolean)
    },

    // Walk overrides/** for video files named "Artist - Title.ext" and return
    // an entry per song (source 'override'). Throws when the folder cannot be
    // read, so a caller can tell "empty" from "unreachable".
    async scanOverrides() {
      if (!dir) return []
      const root = join(dir, 'overrides')
      const files = []
      async function walk(d) {
        for (const de of await readdir(d, { withFileTypes: true })) {
          const full = join(d, de.name)
          if (de.isDirectory()) await walk(full)
          else if (de.isFile() && OVERRIDE_EXTS.has(extname(de.name).toLowerCase())) files.push(full)
        }
      }
      await walk(root)
      files.sort()
      const out = new Map()
      for (const full of files) {
        const name = full.slice(full.lastIndexOf(sep) + 1)
        const stem = name.slice(0, name.length - extname(name).length)
        const at = stem.indexOf(' - ')
        if (at <= 0) continue
        const artist = stem.slice(0, at).trim()
        const title = stem.slice(at + 3).trim()
        if (!artist || !title) continue
        const key = songKey(artist, title)
        if (out.has(key)) continue
        let bytes = 0
        try {
          bytes = (await stat(full)).size
        } catch { continue }
        out.set(key, {
          ...newEntry({ key, artist, title }),
          status: 'ready',
          source: 'override',
          file: relative(resolve(dir), full).split(sep).join('/'),
          bytes,
          pinned: true,
        })
      }
      return [...out.values()]
    },

    // Bring the index in line with overrides/: new files become entries (an
    // override replaces a cached copy of the same song, whose files go), files
    // that vanished drop their entries. Plays survive. Nothing is removed when
    // the folder cannot be read. Resolves { added, removed, replaced, error }.
    async syncOverrides() {
      let found
      try {
        found = await index.scanOverrides()
      } catch (e) {
        return { added: 0, removed: 0, replaced: 0, error: errMsg(e) }
      }
      const seen = new Set()
      let added = 0
      let replaced = 0
      let removed = 0
      let changed = false
      for (const o of found) {
        seen.add(o.key)
        const cur = entries.get(o.key)
        if (cur && cur.source === 'override') {
          if (cur.file !== o.file || cur.bytes !== o.bytes) {
            entries.set(o.key, { ...cur, file: o.file, bytes: o.bytes })
            changed = true
          }
          continue
        }
        if (cur) {
          replaced++
          await deleteFiles(cur)
          entries.set(o.key, {
            ...o,
            album: cur.album || '',
            durationMs: cur.durationMs || 0,
            plays: cur.plays,
            lastPlayedAt: cur.lastPlayedAt,
            denied: cur.denied,
            resolvedAt: now(),
          })
        } else {
          added++
          entries.set(o.key, { ...o, resolvedAt: now() })
        }
        changed = true
      }
      for (const e of [...entries.values()]) {
        if (e.source === 'override' && !seen.has(e.key)) {
          entries.delete(e.key)
          removed++
          changed = true
        }
      }
      if (changed) save()
      return { added, removed, replaced, error: null }
    },

    // Drop every cache entry and everything under cache/, keep overrides and
    // the README. A song's deny list survives as a fresh "not yet matched"
    // entry; plain misses are forgotten (a clean slate retries them).
    // Resolves the number of cached videos removed.
    async clearCache() {
      let n = 0
      for (const e of [...entries.values()]) {
        if (e.source === 'override') continue
        if (e.status === 'ready') n++
        if (e.denied.length) {
          entries.set(e.key, { ...newEntry(e), denied: e.denied, plays: e.plays, lastPlayedAt: e.lastPlayedAt })
        } else {
          entries.delete(e.key)
        }
      }
      save()
      if (dir) {
        try {
          await rm(join(dir, 'cache'), { recursive: true, force: true })
          await mkdir(join(dir, 'cache'), { recursive: true })
        } catch { /* share down: the entries are gone, the files are swept by the next clear */ }
      }
      return n
    },

    // Move a finished download into the folder: copy to a .part name, rename
    // into place so a half file is never served, delete the source.
    async place(srcFull, rel) {
      const dest = absPath(rel)
      if (!dest) throw new Error(`bad path ${rel}`)
      await mkdir(dirname(dest), { recursive: true })
      const part = `${dest}.part`
      await copyFile(srcFull, part)
      await rename(part, dest)
      await unlink(srcFull).catch(() => {})
      return dest
    },

    // Resolves when the NAS write in flight (and any queued behind it) is done.
    async flush() {
      while (nasBusy) await nasBusy
    },
  }
  return index
}
