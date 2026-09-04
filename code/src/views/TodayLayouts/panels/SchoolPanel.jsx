import PanelFrame from './PanelFrame.jsx'
import './SchoolPanel.css'

// SchoolPanel - the day's lunch, Grab & Go, and per-kid activities.
//
// Every row is the same "name . value" pair so the column scans in one pass:
// what it is on the left, what it is today on the right. Rows only exist when
// there is real data behind them; nothing here invents a lunch.
//
// The layout contract passes `now` as well, but nothing in this panel is time
// dependent (school.js has already resolved today's rows), so it is not read.

function rowsFor(school) {
  const out = []
  if (school?.entree) out.push({ key: 'lunch', name: 'Lunch', value: school.entree })
  if (school?.grab) out.push({ key: 'grab', name: 'Grab & Go', value: school.grab })
  const activities = Array.isArray(school?.activities) ? school.activities : []
  activities.forEach((a, i) => {
    if (!a || (!a.name && !a.label)) return
    out.push({ key: `act-${i}`, name: a.name || 'Today', value: a.label || '' })
  })
  return out
}

export default function SchoolPanel({ school }) {
  const rows = rowsFor(school)

  let body
  if (school?.noSchool) {
    body = <div className="tl-school__empty">No school today</div>
  } else if (rows.length === 0) {
    body = <div className="tl-school__empty">Nothing on the schedule</div>
  } else {
    body = (
      <ul className="tl-school__rows">
        {rows.map((r) => (
          <li className="tl-school__row" key={r.key}>
            <span className="tl-school__name">{r.name}</span>
            <span className="tl-school__sep" aria-hidden="true">&middot;</span>
            <span className="tl-school__value">{r.value}</span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <PanelFrame title="Today at school" className="tl-school" bodyClassName="tl-school__body">
      {body}
    </PanelFrame>
  )
}
