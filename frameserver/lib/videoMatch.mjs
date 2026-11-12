// videoMatch.mjs - the pure half of Music Videos: song keys, file names, and
// the scoring that decides which YouTube upload is "the official video".
//
// The living-room TV shows the music video for whatever Sonos is playing
// (docs/designs/music-videos.md). Everything that needs no I/O lives here so
// it can be tested exhaustively: lib/videoIndex.mjs keeps the collection on
// disk, lib/videoResolver.mjs runs Sonos, yt-dlp and ffmpeg.
//
// Song key. One key per song across Pandora and Spotify:
//   songKey('Daft Punk', 'Get Lucky (feat. Pharrell Williams)') -> 'daft punk|get lucky'
//   lowercase, diacritics stripped (NFKD); a trailing " - 2011 Remaster" style
//   segment and bracketed "(feat. ...)", "[Remastered]" groups dropped; the
//   artist cut at the first " feat. " / " & " / " x " / " with "; everything
//   but [a-z0-9 ] removed. Non-Latin names that would collapse to nothing keep
//   their letters, so a Japanese title still gets a key of its own.
//
// Candidate (a flat yt-dlp search result): { id, title, channel | uploader,
// duration (s), view_count }. scoreCandidate returns -1 for a reject, else a
// score; pickCandidate takes the best one at or above ACCEPT_FLOOR (40), else
// null, which the resolver stores as a "none" entry (retried after 7 days).
// Rejects: no duration, a duration under half or over twice Sonos's,
// a title that does not contain the song's title,
// lyric / live / cover / "official audio" / ... words (unless Sonos's own title has the word:
// an instrumental track may match an instrumental video; the artist's own
// name too, so a band called "Live" still matches), an auto-generated
// " - Topic" channel, and any id on the entry's deny list.
//
// Why the title rule: the channel and "official" points alone let another song
// by the same artist win when the right video is not in the results (searching
// Fleetwood Mac "Dreams", the official video of "Gypsy" scored 98 against 108).
// The video's title must contain the song's title (key-normalised), or it is out.
// Why the wide duration window: official videos run long or short against the
// album cut (Get Lucky is 6:09 on Sonos and 4:08 as a video; Blinding Lights
// 3:20 against 4:22), so only 0.5x to 2x is a hard limit (a 30 s teaser or a
// 10 hour loop is out), and a video within 20 % or 45 s earns +15, so a close
// cut beats an extended one when both exist.
//
// Favorites. favoriteFor() matches the player's transport URI to a Sonos
// Favorite the way code/src/lib/sonosSource.js computeSourceLabel does (the URI
// itself, else the container title in the DIDL metadata). favoriteAllowed()
// reads shared.video.favorites ({ name: 'yes' | 'no' }, default yes).

export const ACCEPT_FLOOR = 40
export const MISS_RETRY_MS = 7 * 24 * 60 * 60 * 1000
const DURATION_PCT = 0.2
const DURATION_ABS_S = 45
const DURATION_MIN_RATIO = 0.5
const DURATION_MAX_RATIO = 2
const DURATION_CLOSE_BONUS = 15
const NAME_MAX = 120

// Words that mark an upload as something other than the official video.
const REJECT_RE = new RegExp(
  '\\b(lyric|lyrics|live|cover|karaoke|reaction|audio only|official audio|visuali[sz]er|fan[- ]?made|8d|slowed|sped up|' +
  'nightcore|instrumental|remix|hour|loop|tutorial|teaser|trailer|behind the scenes|making of)\\b',
  'gi',
)

// --- text normalisation -------------------------------------------------------

const stripDiacritics = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '')

// Bracket groups to drop from an artist or a title: the group's text starts
// with one of these (an optional year first, "(2011 Remaster)").
const BRACKET_RE = new RegExp(
  '\\s*[(\\[]\\s*(?:\\d{4}\\s+)?(?:feat|ft|featuring|with|from|remaster(?:ed)?|live|radio edit|single|album|' +
  'mono|stereo|version|edit|mix|deluxe|bonus|demo|explicit|clean|original|sped|slowed)\\b[^)\\]]*[)\\]]',
  'gi',
)
const TITLE_TAIL_RE = /\b(?:remaster(?:ed)?|radio edit|single version|album version|mono|stereo|live|edit|version|mix|deluxe|anniversary)\b/i
const ARTIST_SPLIT_RE = /\s+(?:feat\.?|ft\.?|featuring|&|x|with)\s+/i

// The title without " - 2011 Remaster" style tails and bracketed noise. Case
// and punctuation untouched (searchTerms uses it; songKey lowercases after).
function cleanTitle(title) {
  let t = String(title ?? '')
  for (;;) {
    const at = t.lastIndexOf(' - ')
    if (at < 0 || !TITLE_TAIL_RE.test(t.slice(at + 3))) break
    t = t.slice(0, at)
  }
  return t.replace(BRACKET_RE, '').trim()
}

function cleanArtist(artist) {
  const a = String(artist ?? '').replace(BRACKET_RE, '')
  const m = ARTIST_SPLIT_RE.exec(a)
  return (m ? a.slice(0, m.index) : a).trim()
}

// [a-z0-9 ] only, runs of spaces collapsed. Empty for an all-non-Latin name,
// which then falls back to its letters and digits (any script).
function squash(s) {
  const strict = stripDiacritics(s).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
  if (strict) return strict
  return s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim()
}

// { artist, title } as they enter the key.
export function keyParts(artist, title) {
  return { artist: squash(cleanArtist(artist)), title: squash(cleanTitle(title)) }
}

export function songKey(artist, title) {
  const k = keyParts(artist, title)
  return `${k.artist}|${k.title}`
}

// "<Artist> <Title>" for the YouTube search: the same noise stripped, but
// readable (case and accents kept).
export function searchTerms(artist, title) {
  return `${cleanArtist(artist)} ${cleanTitle(title)}`.replace(/\s+/g, ' ').trim()
}

// --- file names ----------------------------------------------------------------

// A path component that is legal on Windows and SMB: no < > : " / \ | ? * or
// control characters, whitespace collapsed, no trailing dots or spaces, 120
// characters at most.
export function safeName(s, max = NAME_MAX) {
  // Matching control characters is the point.
  // eslint-disable-next-line no-control-regex
  let out = String(s ?? '').replace(/\s+/g, ' ').replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim()
  if (out.length > max) out = out.slice(0, max)
  out = out.replace(/[. ]+$/, '').trim()
  return out || 'Unknown'
}

// Where a cached video lives, relative to MUSIC_VIDEOS_DIR with forward
// slashes (index.json is portable): cache/<ArtistSafe>/<Artist> - <Title>
// [<videoId>].mp4, with the thumbnail beside it. The file name is held to
// 120 characters by shortening "Artist - Title", never the id.
export function cacheFileName({ artist, title, videoId, ext = 'mp4' } = {}) {
  const dir = safeName(artist)
  const tag = videoId ? ` [${safeName(videoId, 40)}]` : ''
  const stem = safeName(`${safeName(artist)} - ${safeName(title)}`, NAME_MAX - tag.length - ext.length - 1)
  const base = `${stem}${tag}`
  return {
    dir,
    base,
    file: `cache/${dir}/${base}.${ext}`,
    thumb: `cache/${dir}/${base}.jpg`,
  }
}

// --- ads -------------------------------------------------------------------------

// A Pandora ad arrives as title "Advertisement" with no artist. Anything with
// no artist cannot be searched for, so it is treated the same way.
export function isAdTrack(track) {
  if (!track) return false
  const title = String(track.title ?? '').trim()
  const artist = String(track.artist ?? '').trim()
  return /^advertisement$/i.test(title) || artist === ''
}

// --- scoring ---------------------------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Hard limits: missing, under half or over twice Sonos's duration. Sonos with
// no duration (radio) has nothing to gate on.
function durationOk(candidateS, sonosMs) {
  if (!(candidateS > 0)) return false
  if (!(sonosMs > 0)) return true
  const s = sonosMs / 1000
  return candidateS >= s * DURATION_MIN_RATIO && candidateS <= s * DURATION_MAX_RATIO
}

// Within 20 % or 45 s of Sonos's duration: the bonus window.
function durationClose(candidateS, sonosMs) {
  if (!(sonosMs > 0)) return false
  const diff = Math.abs(candidateS - sonosMs / 1000)
  return diff <= DURATION_ABS_S || diff <= (sonosMs / 1000) * DURATION_PCT
}

// Reject words in the video title that Sonos's own title (or artist) lacks.
function badWords(videoTitle, sonosTitle, sonosArtist) {
  const own = `${sonosTitle ?? ''} ${sonosArtist ?? ''}`
  const bad = []
  for (const m of String(videoTitle ?? '').matchAll(REJECT_RE)) {
    const w = m[0].toLowerCase()
    if (!new RegExp(`\\b${escapeRe(w)}\\b`, 'i').test(own)) bad.push(w)
  }
  return bad
}

// -1 = rejected. Otherwise the sum described in the header comment.
export function scoreCandidate(candidate, { artist = '', title = '', durationMs = 0, denied = [] } = {}) {
  if (!candidate || typeof candidate.id !== 'string') return -1
  if (Array.isArray(denied) && denied.includes(candidate.id)) return -1
  if (!durationOk(Number(candidate.duration), durationMs)) return -1
  const vTitle = String(candidate.title ?? '')
  const channel = String(candidate.channel ?? candidate.uploader ?? '')
  if (/ - topic\s*$/i.test(channel)) return -1
  if (badWords(vTitle, title, artist).length) return -1

  const k = keyParts(artist, title)
  const chan = squash(channel)
  const vt = squash(vTitle)
  const vtLower = vTitle.toLowerCase()
  // Spaces ignored on both sides: "Go-Go" keys as "gogo", the upload says "Go Go".
  // "&" and "and" are one word: Sonos says "Black & Blue", the artist's own
  // upload says "Black and Blue" (the 2026-11-11 first evening; it missed).
  const flat = (x) => x.replace(/ /g, '')
  const and = (x) => String(x).replace(/&/g, ' and ')
  const titleIn = !k.title || flat(vt).includes(flat(k.title)) ||
    flat(squash(and(vTitle))).includes(flat(keyParts(artist, and(title)).title))
  if (!titleIn) return -1
  let score = 0
  if (durationClose(Number(candidate.duration), durationMs)) score += DURATION_CLOSE_BONUS
  const artistMatch = k.artist && (chan.includes(k.artist) || chan.replace(/ /g, '').includes(k.artist.replace(/ /g, '')))
  if (artistMatch || /vevo\s*$/i.test(channel)) score += 50
  if (vtLower.includes('official video') || vtLower.includes('official music video')) score += 30
  if (vtLower.includes('official')) score += 10
  if (k.title) score += 10
  const views = Number(candidate.view_count)
  if (views > 0) score += Math.min(10, Math.log10(views + 1))
  return score
}

// The best acceptable candidate, { candidate, score }, or null. Ties go to the
// more viewed upload, then to the earlier search rank.
export function pickCandidate(candidates, ctx = {}) {
  let best = null
  for (const [rank, candidate] of (Array.isArray(candidates) ? candidates : []).entries()) {
    const score = scoreCandidate(candidate, ctx)
    if (score < ACCEPT_FLOOR) continue
    const views = Number(candidate.view_count) || 0
    if (!best || score > best.score || (score === best.score && views > best.views)) {
      best = { candidate, score, views, rank }
    }
  }
  return best ? { candidate: best.candidate, score: best.score } : null
}

// --- Sonos favorites -------------------------------------------------------------

// <dc:title> out of a DIDL-Lite blob (what code/src/lib/sonosSource.js
// extractDcTitle does), entities decoded.
export function dcTitle(xml) {
  if (!xml || typeof xml !== 'string') return null
  const m = xml.match(/<dc:title>([\s\S]*?)<\/dc:title>/i)
  if (!m) return null
  const t = m[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim()
  return t || null
}

// Pandora labels a user's own stations "Name (My Station)".
export function cleanStationName(name) {
  if (!name) return ''
  return String(name).replace(/\s*\((My Station|Shared)\)\s*$/i, '').trim()
}

// The Sonos Favorite playing now, by name, or null. favorites: [{ name, uri }].
// The transport URI matches the favorite's own URI first; a queue-based source
// (a Spotify playlist plays from x-rincon-queue) is matched by the container
// title in the transport metadata instead, case-insensitively and ignoring
// Pandora's "(My Station)" tag.
export function favoriteFor(avTransportUri, favorites, avTransportUriMetadata = '') {
  const list = Array.isArray(favorites) ? favorites.filter((f) => f && f.name) : []
  if (avTransportUri) {
    const hit = list.find((f) => f.uri && f.uri === avTransportUri)
    if (hit) return hit.name
  }
  const title = dcTitle(avTransportUriMetadata)
  if (title) {
    const want = cleanStationName(title).toLowerCase()
    const hit = list.find((f) => cleanStationName(f.name).toLowerCase() === want)
    if (hit) return hit.name
  }
  return null
}

// shared.video.favorites is { "<favorite name>": "yes" | "no" }; anything
// not set to "no" plays videos. Looks the name up as is, with Pandora's tag
// removed, and case-insensitively.
export function favoriteAllowed(name, sharedVideo) {
  const prefs = sharedVideo && typeof sharedVideo === 'object' ? sharedVideo.favorites : null
  if (!name || !prefs || typeof prefs !== 'object') return true
  const wants = [String(name), cleanStationName(name)]
  for (const w of wants) if (typeof prefs[w] === 'string') return prefs[w].toLowerCase() !== 'no'
  const lower = new Set(wants.map((w) => w.toLowerCase()))
  for (const [k, v] of Object.entries(prefs)) {
    if (lower.has(k.toLowerCase()) || lower.has(cleanStationName(k).toLowerCase())) {
      return String(v).toLowerCase() !== 'no'
    }
  }
  return true
}
