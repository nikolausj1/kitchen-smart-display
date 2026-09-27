import { Fragment } from 'react'
import PanelFrame from './PanelFrame.jsx'
import { knobDefaults, panelKnobs } from './schemas.js'
import { dateParts } from '../lib/dates.js'
import './DatePanel.css'

// DatePanel - today's date and nothing else (docs/designs/
// panels-and-controls.md, chunk 4), as large as its box allows, centred in
// it by design and aligned by the box's align (centre unless set).
//
// knobs (panels/schemas.js 'date'):
//   format    'long' (Saturday, September 26), 'medium' (Sat, Sep 26),
//             'short' (9/26), 'dayname' (Saturday) or 'daynumber' (a big 26
//             under a small Sep); lib/dates.js dateParts
//   showYear  the year too (not with the day name alone)
//   size
// The universal align is the date's own too (declared in its schema, as the
// text block does), so the inspector shows it with these.
//
// The line is the 'text' element; its weekday, month, day and year are
// elements of their own, so each can be styled apart ("the day in the
// accent"). A long or medium date may break after the weekday's comma, and
// nowhere else ("Saturday, / September 26"): in a narrow box two lines give
// it bigger type than one (DatePanel.css).
//
// now: the layout's clock (useTodayData, 1 Hz).

const FORMATS = ['long', 'medium', 'short', 'dayname', 'daynumber']

function Part({ p }) {
  if (!p.key) return p.text
  return (
    <span className={`tl-date__${p.key}`} data-edit={p.key}>
      {p.text}
    </span>
  )
}

// A date's words that must stay on one line: a date that leads with its
// weekday breaks after the weekday's comma, and only there.
function lineGroups(parts) {
  const i = parts.findIndex((p) => p.key === null && p.text === ', ')
  if (i < 0 || !parts.length || parts[0].key !== 'weekday') return [parts]
  return [parts.slice(0, i).concat([{ key: null, text: ',' }]), parts.slice(i + 1)]
}

export default function DatePanel({ now, knobs }) {
  const k = panelKnobs('date', knobs) || knobDefaults('date')
  const format = FORMATS.indexOf(k.format) >= 0 ? k.format : 'long'
  const opts = { year: !!k.showYear }
  const parts = dateParts(now, format, opts)
  const year = opts.year && format !== 'dayname'
  const cls = `tl-date tl-date--${format}${year ? ' tl-date--year' : ''} tl-knobs`

  if (format === 'daynumber') {
    // The month (and year) small over the day, big.
    const day = parts.length ? parts[parts.length - 1] : null
    const top = parts.slice(0, -1)
    return (
      <PanelFrame title={null} className={cls} bodyClassName="tl-date__body" style={{ '--tl-date-size': String(k.size) }}>
        <div className="tl-date__text tl-date__stack" data-edit="text">
          <div className="tl-date__over">
            {top.map((p, i) => (
              <Part key={i} p={p} />
            ))}
          </div>
          {day && (
            <div className="tl-date__big tl-num">
              <Part p={day} />
            </div>
          )}
        </div>
      </PanelFrame>
    )
  }

  return (
    <PanelFrame title={null} className={cls} bodyClassName="tl-date__body" style={{ '--tl-date-size': String(k.size) }}>
      <div className="tl-date__text tl-date__line" data-edit="text">
        {lineGroups(parts).map((group, g) => (
          <Fragment key={g}>
            {g > 0 && ' '}
            <span className="tl-date__words">
              {group.map((p, i) => (
                <Part key={i} p={p} />
              ))}
            </span>
          </Fragment>
        ))}
      </div>
    </PanelFrame>
  )
}
