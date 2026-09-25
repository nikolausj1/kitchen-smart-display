// Dayparts - the Entry board's day-part tabs above the stage: Day (the base
// layout) and the variants the app switches to on its own (Morning on a
// school morning, Evening from `eveningFrom`, Weekend on Saturday and
// Sunday). A tab with a layout of its own carries a dot. On a tab without
// one, "Create <part> from Day" copies the base; on one with, "Remove" drops
// it (the screen shows Day then). Both are one undo step.

import { DAYPART_LABELS, partWhen } from './spec.js'

export default function Dayparts({ parts, active, has, eveningFrom, disabled, onPick, onCreate, onRemove }) {
  const name = DAYPART_LABELS[active]
  const info =
    active === 'day'
      ? 'The base layout, shown whenever no other part applies.'
      : has[active]
        ? `Shown ${partWhen(active, eveningFrom)}.`
        : `No layout of its own: the screen shows Day ${partWhen(active, eveningFrom)}.`
  return (
    <div className="ed-parts">
      <div className="ed-parts__tabs" role="tablist" aria-label="Day parts">
        {parts.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={p === active}
            className={`ed-part${p === active ? ' is-on' : ''}${p !== 'day' && !has[p] ? ' is-empty' : ''}`}
            disabled={disabled}
            onClick={() => onPick(p)}
            title={p === 'day' ? 'The base layout' : has[p] ? `${DAYPART_LABELS[p]}: its own layout` : `${DAYPART_LABELS[p]}: uses Day's layout`}
          >
            {DAYPART_LABELS[p]}
            {p !== 'day' && has[p] && <span className="ed-part__dot" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <span className="ed-parts__info">{info}</span>
      <span className="ed-spacer" />
      {active !== 'day' &&
        (has[active] ? (
          <button type="button" className="ed-btn ed-btn--danger" disabled={disabled} onClick={onRemove} title={`Drop ${name}'s own layout; Undo brings it back`}>
            Remove {name}
          </button>
        ) : (
          <button type="button" className="ed-btn ed-btn--primary" disabled={disabled} onClick={onCreate}>
            Create {name} from Day
          </button>
        ))}
    </div>
  )
}
