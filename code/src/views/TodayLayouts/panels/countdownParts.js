import { hubUrl } from '../../../lib/hub.js'

// countdownParts.js - what the countdown panels share, as plain functions:
// the tiles (CountdownsPanel.jsx) and the art-above card (CountdownCard.jsx).
// Pure, so Node can test it (countdownParts.test.mjs).
//
// A countdown is the hub's (GET /api/calendar, frameserver/lib/countdowns.mjs,
// with daysLeft recounted by lib/agenda.js countdownsFor):
//   { id, title, date, daysLeft, image, emoji, calendarLabel, color, tileColor }

// '/countdown-art/x.png' -> the hub's URL for it. Absolute and data: URLs are
// left alone, so a fixture can point anywhere.
export function artUrl(image) {
  if (typeof image !== 'string' || !image.trim()) return null
  const s = image.trim()
  if (/^(https?:|data:|blob:)/i.test(s)) return s
  return hubUrl(s)
}

// The emoji a countdown can show for art, or null.
export function emojiOf(countdown) {
  const e = countdown && countdown.emoji
  return typeof e === 'string' && e.trim() ? e.trim() : null
}

// The title a countdown shows ('' for none: the tile says "Countdown").
export function titleOf(countdown) {
  const t = countdown && countdown.title
  return typeof t === 'string' ? t.trim() : ''
}

// Does the countdown have art to show (a picture or an emoji)? A picture that
// then fails to load leaves one with no art: the card finds that out itself.
export function hasArt(countdown) {
  return !!artUrl(countdown && countdown.image) || !!emojiOf(countdown)
}

// dayCount(countdown) -> { days, today, text, unit }: the number a tile shows
// and the word under it. '--' and DAYS with no count, the word Today (no
// unit) on the day, then DAY and DAYS.
export function dayCount(countdown) {
  const n = countdown && countdown.daysLeft
  const days = typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : null
  if (days == null) return { days, today: false, text: '--', unit: 'DAYS' }
  if (days === 0) return { days, today: true, text: 'Today', unit: '' }
  return { days, today: false, text: String(days), unit: days === 1 ? 'DAY' : 'DAYS' }
}
