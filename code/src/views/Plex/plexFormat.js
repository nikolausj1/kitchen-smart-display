// plexFormat - the words and numbers the Plex view prints. Pure.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 10:48 (12-hour, no am/pm: the Now Playing view's clock).
export function fmtClock(d) {
  const h = d.getHours() % 12 || 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}`
}

// A runtime: "25 min", "1 hr 6 min", "2 hr".
export function fmtRuntime(ms) {
  const total = Math.round((Number(ms) || 0) / 60000)
  if (total <= 0) return null
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m} min`
  return m ? `${h} hr ${m} min` : `${h} hr`
}

function dateParts(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null
}

// '2019-10-12' -> '12 Oct 2019' (read as a calendar date, no time zone).
export function fmtDate(key) {
  const p = dateParts(key)
  if (!p) return null
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`
}

// Whole years from a birthday to a date key (a death day) or to nowMs.
// null when the birthday does not parse.
export function yearsOld(birthday, deathday, nowMs = Date.now()) {
  const b = dateParts(birthday)
  if (!b) return null
  let e = dateParts(deathday)
  if (!e) {
    const n = new Date(nowMs)
    e = { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() }
  }
  const age = e.y - b.y - (e.m < b.m || (e.m === b.m && e.d < b.d) ? 1 : 0)
  return age >= 0 && age < 130 ? age : null
}

// "just now", "5 min ago", "3 hours ago", "yesterday", "4 days ago".
export function fmtAgo(iso, nowMs) {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return null
  const mins = Math.round((nowMs - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

// Plex disambiguates a remade show's title with its year ("The Studio
// (2025)"); the screen does not need that.
export function cleanShowTitle(t) {
  return String(t || '').replace(/\s+\((19|20)\d{2}\)$/, '')
}

// A character name for a one-line caption: TMDB's " (voice)" says nothing an
// animated film does not, and costs the end of the name. Someone playing
// themselves (a cameo credited under their own name) is "Self".
export function cleanRole(role, name) {
  const s = String(role || '').replace(/\s*\(voice\)\s*$/i, '').trim()
  if (!s) return null
  return name && s.toLowerCase() === String(name).trim().toLowerCase() ? 'Self' : s
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts[0][0] || ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : ''
  return (first + last).toUpperCase()
}

// A muted colour for a missing headshot, the same for the same name.
export function nameTint(name) {
  let h = 0
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `hsl(${h}, 24%, 27%)`
}

// "S3 E7" for a last-played line.
export function episodeCode(season, episode) {
  if (season == null || episode == null) return null
  return `S${season} E${episode}`
}

// "S1 · E2 · The Oner", the strip's second line for an episode.
export function episodeLine(season, episode, title) {
  return [season != null ? `S${season}` : null, episode != null ? `E${episode}` : null, title || null]
    .filter(Boolean)
    .join(' · ')
}

// A title for matching TMDB's list against Plex's: case, accents,
// punctuation and a leading article do not count.
export function titleKey(title) {
  return String(title || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '')
}

// The same film or show: the same title, and years at most one apart (a
// festival premiere against a release) or one of them unknown.
export function sameWork(a, b) {
  if (!a || !b || titleKey(a.title) !== titleKey(b.title)) return false
  const ya = Number(a.year)
  const yb = Number(b.year)
  return !ya || !yb || Math.abs(ya - yb) <= 1
}
