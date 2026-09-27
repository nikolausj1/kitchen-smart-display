import './HaParts.css'

// HaIcon - the Home Assistant panels' icons (docs/designs/panels-and-controls.md,
// chunk 5): one per kind and state, drawn inline as 24 x 24 line art in
// currentColor, so each takes its panel's tone (HaParts.css). The name comes
// from panels/haParts.js haIconName: cover (a garage, its door down or up),
// lock (shackle shut or open), door (shut, or its leaf swung open), light (a
// bulb, with rays when on), switch (a toggle), mode (a house, its dot filled
// when on), select (a list), person (at home, or heading out), sensor (a
// gauge), camera, todo, other.
//
// HaSpinner and HaCheck are the button's and the picker's pending and done
// marks, in the same line weight.

// Each shape: { d } a path, { c: [cx, cy, r] } a circle, { r: [x, y, w, h,
// rx] } a rectangle; fill: true fills it, dot: true is a fat round point.
const GARAGE = [{ d: 'M3 10.6 12 4l9 6.6' }, { d: 'M5 9.2V20.5h14V9.2' }, { d: 'M8.2 20.5V12.2h7.6v8.3' }]
const LOCK_BODY = [{ r: [5.5, 10.5, 13, 10, 2] }, { d: 'M12 14.4v2.3' }]
const DOOR_FRAME = [{ d: 'M5.5 20.5V3.5h13v17' }, { d: 'M3.5 20.5h17' }]
const BULB = [
  { d: 'M9.3 17.3h5.4' },
  { d: 'M10.2 20.3h3.6' },
  { d: 'M12 3.6a5.6 5.6 0 0 0-3.4 10.05c.6.46.95 1.17.95 1.93v1.72h4.9v-1.72c0-.76.35-1.47.95-1.93A5.6 5.6 0 0 0 12 3.6z' },
]
const HOUSE = [{ d: 'M4 10.8 12 4.2l8 6.6v9.5H4z' }]
const PERSON = [{ c: [12, 7.9, 3.6] }, { d: 'M4.8 20.5c.7-3.9 3.6-6.3 7.2-6.3s6.5 2.4 7.2 6.3' }]
const LIST_LINES = [{ d: 'M9.5 7h10' }, { d: 'M9.5 12h10' }, { d: 'M9.5 17h10' }]

const ICONS = {
  'cover-closed': GARAGE.concat([{ d: 'M8.2 15h7.6' }, { d: 'M8.2 17.8h7.6' }]),
  'cover-open': GARAGE.concat([{ d: 'M8.2 14.2h7.6' }]),
  'lock-locked': LOCK_BODY.concat([{ d: 'M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7' }]),
  'lock-unlocked': LOCK_BODY.concat([{ d: 'M8.5 10.5V7.3a3.5 3.5 0 0 1 6.95-.65' }]),
  'door-closed': DOOR_FRAME.concat([{ d: 'M15.2 12.3h.01', dot: true }]),
  'door-open': DOOR_FRAME.concat([{ d: 'M5.5 3.5 11.8 5.4v16.3l-6.3-1.2z' }, { d: 'M10 13h.01', dot: true }]),
  'light-off': BULB,
  'light-on': BULB.concat([{ d: 'M2.9 9.4h1.6' }, { d: 'M19.5 9.4h1.6' }, { d: 'M5.2 3.3l1.1 1.1' }, { d: 'M18.8 3.3l-1.1 1.1' }]),
  'switch-off': [{ r: [2.5, 7, 19, 10, 5] }, { c: [7.5, 12, 2.7] }],
  'switch-on': [{ r: [2.5, 7, 19, 10, 5] }, { c: [16.5, 12, 2.7], fill: true }],
  'mode-off': HOUSE.concat([{ c: [12, 14.4, 2.3] }]),
  'mode-on': HOUSE.concat([{ c: [12, 14.4, 2.3], fill: true }]),
  select: LIST_LINES.concat([{ d: 'M5 7h.01', dot: true }, { d: 'M5 12h.01', dot: true }, { d: 'M5 17h.01', dot: true }]),
  'person-home': PERSON,
  'person-away': PERSON.concat([{ d: 'M17.4 6.4h4' }, { d: 'M19.6 4.4l1.9 2-1.9 2' }]),
  sensor: [{ d: 'M4.6 16.8a8.2 8.2 0 1 1 14.8 0' }, { d: 'M12 13.3l3.6-4.1' }, { d: 'M12 13.3h.01', dot: true }],
  camera: [{ r: [3, 7, 13, 10, 2] }, { d: 'M16 10.6l5-2.8v8.4l-5-2.8' }],
  todo: LIST_LINES.concat([{ d: 'M3.9 7.1l1.1 1.1 1.9-2.2' }, { d: 'M3.9 12.1l1.1 1.1 1.9-2.2' }, { d: 'M3.9 17.1l1.1 1.1 1.9-2.2' }]),
  other: [{ c: [12, 12, 7.5] }, { d: 'M12 12h.01', dot: true }],
}

function Shape({ s }) {
  const cls = s.fill ? 'is-fill' : s.dot ? 'is-dot' : undefined
  if (s.c) return <circle cx={s.c[0]} cy={s.c[1]} r={s.c[2]} className={cls} />
  if (s.r) return <rect x={s.r[0]} y={s.r[1]} width={s.r[2]} height={s.r[3]} rx={s.r[4]} className={cls} />
  return <path d={s.d} className={cls} />
}

export default function HaIcon({ name, className = '' }) {
  const shapes = Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : ICONS.other
  return (
    <svg className={`tl-ha-icon ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {shapes.map((s, i) => (
        <Shape key={i} s={s} />
      ))}
    </svg>
  )
}

// A quarter-open circle turning (HaParts.css): a press on its way.
export function HaSpinner({ className = '' }) {
  return (
    <svg className={`tl-ha-icon tl-ha-spinner ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />
    </svg>
  )
}

// A tick: the press went through.
export function HaCheck({ className = '' }) {
  return (
    <svg className={`tl-ha-icon ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12.6l4.3 4.3L19 7.4" />
    </svg>
  )
}
