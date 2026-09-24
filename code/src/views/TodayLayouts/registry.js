// Today layout registry - the ids a screen can choose from, and their labels.
// Kept as plain data (no components) so Settings and the kiosk URL parser can
// import it without pulling the layouts into their bundles. The component map
// lives in TodayLayoutSwitch.jsx.

export const LAYOUT_IDS = ['framed', 'board', 'briefing', 'ambient', 'entry']

export const LAYOUT_LABELS = {
  framed: 'Framed (original)',
  board: 'Board',
  briefing: 'Briefing',
  ambient: 'Ambient',
  entry: 'Entry board',
}

export function normalizeLayoutId(id) {
  return LAYOUT_IDS.includes(id) ? id : 'framed'
}
