// Today layout registry - the ids a screen can choose from, and their labels.
// Kept as plain data (no components) so Settings and the kiosk URL parser can
// import it without pulling the layouts into their bundles. The component map
// lives in TodayLayoutSwitch.jsx.
//
// entry and board are drawn from a layout spec (layoutSpec.js LAYOUT_IDS_SPEC)
// and so can be edited in the layout editor; the others are fixed
// compositions. clock is the flip clock (Clock/ClockLayout.jsx).

export const LAYOUT_IDS = ['framed', 'board', 'briefing', 'ambient', 'entry', 'clock']

export const LAYOUT_LABELS = {
  framed: 'Framed (original)',
  board: 'Board',
  briefing: 'Briefing',
  ambient: 'Ambient',
  entry: 'Entry board',
  clock: 'Flip clock',
}

export function normalizeLayoutId(id) {
  return LAYOUT_IDS.includes(id) ? id : 'framed'
}
