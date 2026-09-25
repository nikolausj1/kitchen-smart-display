// plexFormat - the words and numbers the Plex view prints. Pure.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 10:48 (12-hour, no am/pm: the Now Playing view's clock).
export function fmtClock(d) {
  const h = d.getHours() % 12 || 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 13:22, or 1:02:15 past the hour.
export function fmtTimecode(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
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

// Time left: "52 min left", "1 hr 4 min left", "under a minute left".
export function fmtLeft(ms) {
  const mins = Math.floor((Number(ms) || 0) / 60000)
  if (mins < 1) return 'under a minute left'
  return `${fmtRuntime(mins * 60000)} left`
}

// '2019-10-12' -> '12 Oct 2019' (read as a calendar date, no time zone).
export function fmtDate(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
  if (!m) return null
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
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

// "IMDb 8.1", "TMDB 8.0", "RT 92%", or a bare number.
export function fmtAudience(rating, source) {
  const n = Number(rating)
  if (!Number.isFinite(n) || n <= 0) return null
  if (source === 'imdb') return `IMDb ${n.toFixed(1)}`
  if (source === 'tmdb') return `TMDB ${n.toFixed(1)}`
  if (source === 'rottentomatoes') return `RT ${Math.round(n * 10)}%`
  return n.toFixed(1)
}

// "Seth Rogen", "Seth Rogen and Evan Goldberg", "A, B and C".
export function joinNames(names, max = 3) {
  const list = (Array.isArray(names) ? names : []).filter(Boolean).slice(0, max)
  if (list.length <= 1) return list[0] || ''
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts[0][0] || ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : ''
  return (first + last).toUpperCase()
}

// "S3 E7" for a last-played line.
export function episodeCode(season, episode) {
  if (season == null || episode == null) return null
  return `S${season} E${episode}`
}
