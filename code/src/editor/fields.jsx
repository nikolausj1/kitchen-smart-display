// fields.jsx - the inspector's controls. Plain inputs, compact, keyboard
// friendly: number fields commit on Enter or blur (Esc cancels) and step with
// the arrow keys (Shift x10); sliders and colour pickers report every value
// and the caller coalesces them into one undo step.
//
// Two controls follow a field's `ui` (schema.js, "the field vocabulary"):
// HourRangeField, an hourRange pair as one slider with two handles (one
// while the other side is hidden), and TimeListField, a timeList as chips
// with an Add time. SchemaField draws the time list itself; a pair needs both
// fields, so the inspector draws it.

import { useId, useLayoutEffect, useRef, useState } from 'react'
import { hourRangeTrack, optionValue, placeHandle, timeListMax } from './schema.js'
import {
  addToTimeList,
  clamp,
  colorForWell,
  decimalsOf,
  hourLabel,
  hourRangeText,
  hourTicks,
  parseTimeList,
  timeLabel,
  timeListText,
  timeMinutes,
  timeText,
} from './util.js'

const fmt = (v, digits) => (Number.isFinite(v) ? String(Number(v.toFixed(digits))) : '')

export function NumberField({ value, onCommit, min = -Infinity, max = Infinity, step = 1, digits = 0, prefix, suffix, disabled, title, ariaLabel, inputRef }) {
  const [text, setText] = useState(null) // null: not editing, show the value
  const cancelled = useRef(false)
  const shown = text ?? fmt(value, digits)

  function commit(raw) {
    const n = Number(String(raw).trim().replace(',', '.'))
    if (String(raw).trim() !== '' && Number.isFinite(n)) {
      const v = clamp(Number(n.toFixed(digits)), min, max)
      if (v !== value) onCommit(v)
    }
  }

  return (
    <label className={`ed-num${disabled ? ' is-disabled' : ''}`} title={title}>
      {prefix && <span className="ed-num__prefix">{prefix}</span>}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        spellCheck={false}
        aria-label={ariaLabel || prefix || title}
        value={shown}
        disabled={disabled}
        onFocus={(e) => {
          cancelled.current = false
          setText(fmt(value, digits))
          e.currentTarget.select()
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!cancelled.current && text != null) commit(text)
          setText(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            cancelled.current = true
            e.currentTarget.blur()
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const base = Number(String(text ?? value).replace(',', '.'))
            const from = Number.isFinite(base) ? base : value
            const next = clamp(Number((from + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)).toFixed(digits)), min, max)
            setText(fmt(next, digits))
            if (next !== value) onCommit(next)
          }
        }}
      />
      {suffix && <span className="ed-num__suffix">{suffix}</span>}
    </label>
  )
}

export function Slider({ value, min, max, step, onChange, disabled, ariaLabel }) {
  return (
    <input
      type="range"
      className="ed-range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}

// A slider with a typed field beside it. `scale` shows the value multiplied
// (opacity 0.4 as 40), the stored value stays unscaled.
const scaled = (v, scale) => Number((v * scale).toFixed(6))

// fieldMin / fieldMax let the typed field go past the slider's range.
export function SliderField({ label, value, min, max, fieldMin, fieldMax, step, digits = 2, suffix, scale = 1, onChange, onCommit, disabled, hint }) {
  const shown = scaled(value, scale)
  // Room for five figures and more (an interval in ms).
  const wide = String(Math.round(Math.abs(scaled(fieldMax ?? max, scale)))).length + (digits > 0 ? digits + 1 : 0) > 4
  return (
    <Row label={label} hint={hint}>
      <div className={`ed-sliderfield${wide ? ' is-wide' : ''}`}>
        <Slider
          value={shown}
          min={scaled(min, scale)}
          max={scaled(max, scale)}
          step={scaled(step, scale)}
          disabled={disabled}
          ariaLabel={label}
          onChange={(v) => onChange(v / scale)}
        />
        <NumberField
          value={shown}
          min={scaled(fieldMin ?? min, scale)}
          max={scaled(fieldMax ?? max, scale)}
          step={scaled(step, scale)}
          digits={digits}
          suffix={suffix}
          disabled={disabled}
          ariaLabel={`${label} value`}
          onCommit={(v) => (onCommit || onChange)(v / scale)}
        />
      </div>
    </Row>
  )
}

export function Segmented({ options, value, onChange, disabled, ariaLabel }) {
  return (
    <div className="ed-seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map(([v, text, title]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={v === value}
          className={v === value ? 'is-on' : undefined}
          title={title}
          disabled={disabled}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, ariaLabel, disabled, title }) {
  return (
    <label className={`ed-toggle${disabled ? ' is-disabled' : ''}`} title={title}>
      <input
        type="checkbox"
        role="switch"
        checked={!!checked}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ed-toggle__track" aria-hidden="true" />
      {label && <span className="ed-toggle__label">{label}</span>}
    </label>
  )
}

// A label column and a control. The label is a real <label> only when it
// can point at one control (htmlFor); otherwise the controls carry their own
// aria-labels.
// A short hint sits under the label; a long one (a schema's help line) gets
// the row's full width underneath, rather than a tall, narrow column.
const LONG_HINT = 24
export function Row({ label, hint, children, htmlFor }) {
  const long = typeof hint === 'string' && hint.length > LONG_HINT
  const text = (
    <>
      {label}
      {hint && !long && <small>{hint}</small>}
    </>
  )
  return (
    <div className="ed-row">
      {htmlFor ? (
        <label className="ed-row__label" htmlFor={htmlFor}>
          {text}
        </label>
      ) : (
        <span className="ed-row__label">{text}</span>
      )}
      <div className="ed-row__control">{children}</div>
      {long && <small className="ed-row__hint">{hint}</small>}
    </div>
  )
}

// A one-line text input that commits on Enter or blur (Esc cancels).
export function TextField({ value, onCommit, placeholder, ariaLabel, id }) {
  const [text, setText] = useState(null)
  const cancelled = useRef(false)
  return (
    <input
      id={id}
      type="text"
      className="ed-text"
      spellCheck={false}
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={text ?? value ?? ''}
      onFocus={() => {
        cancelled.current = false
        setText(value ?? '')
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (!cancelled.current && text != null && text !== value) onCommit(text)
        setText(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
    />
  )
}

// A colour well and its hex. The well only speaks #rrggbb; the field keeps
// whatever valid hex the spec holds (#rgb, #rgba, #rrggbbaa too).
//
// nullable: the colour may be unset (null), which means "Auto" or "Global"
// (nullLabel): the look as designed, or the layout's own colour. A chip beside
// the hex clears it and reads as on while it is unset; an empty hex clears it
// too. The well then shows `unsetWell`, a stand-in only.
export function ColorField({ value, onChange, onCommit, label, hint, nullable, nullLabel = 'Auto', unsetWell = '#808080' }) {
  const id = useId()
  const unset = nullable && !value
  const commit = onCommit || onChange
  return (
    <Row label={label} htmlFor={id} hint={hint}>
      <div className={`ed-color${nullable ? ' ed-color--nullable' : ''}${unset ? ' is-unset' : ''}`}>
        <input
          id={id}
          type="color"
          value={colorForWell(value || unsetWell)}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
        <TextField
          value={value || ''}
          placeholder={unset ? nullLabel : undefined}
          ariaLabel={`${label} hex`}
          onCommit={(v) => (nullable && !String(v).trim() ? commit(null) : commit(v))}
        />
        {nullable && (
          <button
            type="button"
            className={`ed-chip${unset ? ' is-on' : ''}`}
            aria-pressed={unset}
            title={unset ? `${label}: ${nullLabel}` : `Back to ${nullLabel}`}
            onClick={() => !unset && commit(null)}
          >
            {nullLabel}
          </button>
        )}
      </div>
    </Row>
  )
}

// A time of day as 'HH:MM' (24 h; the browser shows it in the Mac's own
// format). Commits every complete value.
export function TimeField({ value, onChange, ariaLabel, disabled }) {
  return (
    <input
      type="time"
      className="ed-time"
      value={value || ''}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => {
        if (e.target.value) onChange(e.target.value)
      }}
    />
  )
}

// A dropdown over [value, label] options; values keep their type (numbers
// stay numbers).
export function SelectField({ options, value, onChange, ariaLabel, disabled }) {
  const i = options.findIndex((o) => o[0] === value)
  return (
    <select
      className="ed-select"
      value={i < 0 ? '' : String(i)}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => {
        const o = options[Number(e.target.value)]
        if (o) onChange(o[0])
      }}
    >
      {i < 0 && <option value="">{value == null ? '' : String(value)}</option>}
      {options.map((o, n) => (
        <option key={String(o[0])} value={String(n)}>
          {o[1]}
        </option>
      ))}
    </select>
  )
}

// Up to four options read best as a segmented control: beside the label when
// it fits the control column, under it when it fits the section, else (and
// for more options, or long labels like "Thursday, September 24") a dropdown.
// Width estimated at ~6.5 px a character (12 px text) and 19 px a segment.
const INLINE_MAX = 172 // the control column of the 300 px inspector
const STACK_MAX = 272 // a section's full width
function selectKind(options) {
  if (options.length > 4) return 'menu'
  const w = options.reduce((n, o) => n + String(o[1]).length * 6.5 + 19, 0)
  return w <= INLINE_MAX ? 'inline' : w <= STACK_MAX ? 'stack' : 'menu'
}

// One schema field (docs/designs/layout-editor.md, Contract v2): number = a
// slider and a typed field with its unit, select =
// segmented or a dropdown, toggle, color = a swatch and its hex (with an
// "Auto" chip when the field is nullable), text = an input, or a textarea when
// the field is multiline.
export function SchemaField({ field, value, onChange, textRef }) {
  const hint = typeof field.hint === 'string' ? field.hint : undefined
  switch (field.type) {
    case 'number': {
      const min = Number.isFinite(field.min) ? field.min : 0
      const max = Number.isFinite(field.max) ? field.max : Math.max(min + 1, Number(value) * 2 || 1)
      const step = Number.isFinite(field.step) && field.step > 0 ? field.step : max - min <= 5 ? 0.05 : 1
      const v = Number.isFinite(Number(value)) ? Number(value) : min
      return (
        <SliderField
          label={field.label}
          hint={hint}
          value={v}
          min={min}
          max={max}
          step={step}
          digits={decimalsOf(step)}
          suffix={field.unit || undefined}
          onChange={onChange}
        />
      )
    }
    case 'select': {
      const current = optionValue(field, value)
      const kind = selectKind(field.options)
      const seg = (
        <Segmented ariaLabel={field.label} options={field.options.map((o) => [o[0], o[1], o[1]])} value={current} onChange={onChange} />
      )
      if (kind === 'stack') {
        return (
          <div className="ed-row ed-row--stack">
            <span className="ed-row__label">
              {field.label}
              {hint && <small>{hint}</small>}
            </span>
            {seg}
          </div>
        )
      }
      return (
        <Row label={field.label} hint={hint}>
          {kind === 'inline' ? seg : <SelectField ariaLabel={field.label} options={field.options} value={current} onChange={onChange} />}
        </Row>
      )
    }
    case 'toggle':
      return (
        <Row label={field.label} hint={hint}>
          <Toggle ariaLabel={field.label} checked={!!value} onChange={onChange} />
        </Row>
      )
    case 'color':
      return (
        <ColorField
          label={field.label}
          hint={hint}
          value={typeof value === 'string' ? value : field.nullable ? null : ''}
          nullable={!!field.nullable}
          nullLabel={typeof field.nullLabel === 'string' && field.nullLabel ? field.nullLabel : undefined}
          onChange={onChange}
        />
      )
    case 'text':
      if (field.ui === 'timeList') return <TimeListField field={field} value={value} onChange={onChange} />
      if (field.multiline || field.rows > 1) {
        return (
          <div className="ed-row ed-row--stack">
            <span className="ed-row__label">
              {field.label}
              {hint && <small>{hint}</small>}
            </span>
            <textarea
              ref={textRef}
              className="ed-textarea"
              rows={field.rows > 1 ? field.rows : 3}
              maxLength={Number.isFinite(field.maxLength) ? field.maxLength : 2000}
              spellCheck
              aria-label={field.label}
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        )
      }
      return (
        <Row label={field.label} hint={hint}>
          <TextField
            value={typeof value === 'string' ? value : ''}
            ariaLabel={field.label}
            placeholder={field.placeholder}
            onCommit={onChange}
          />
        </Row>
      )
    default:
      return null
  }
}

// A stacked field's first line: its label (a short hint under it) and, on
// the right, what it is set to.
function FieldHead({ label, hint, value, htmlFor }) {
  const short = typeof hint === 'string' && hint.length <= LONG_HINT
  const text = (
    <>
      {label}
      {short && <small>{hint}</small>}
    </>
  )
  return (
    <div className="ed-fieldhead">
      {htmlFor ? (
        <label className="ed-row__label" htmlFor={htmlFor}>
          {text}
        </label>
      ) : (
        <span className="ed-row__label">{text}</span>
      )}
      {value != null && <span className="ed-fieldhead__value">{value}</span>}
    </div>
  )
}

// --- ui: 'hourRange' ------------------------------------------------------------------
//
// Two number fields (hours) as one slider with two handles: the first field's
// label, and "8 am to 10 pm" beside it; the track spans both fields' ranges
// with its hours marked under it. Each handle writes its own field and stays
// at least one step short of the other, so they never cross.
//
// Pointer: press a handle and drag it, or press the track and the nearer
// handle jumps there and follows. Each drag is ONE undo step: its changes
// carry a coalesce key of their own with no time limit (run: { key,
// windowMs: Infinity }), as a drag on the stage does. Keys, on a focused
// handle: the arrows move a step, Shift-arrows three, Page Up and Down three,
// Home and End to its ends; a burst of presses is one step (run: the field's
// key), as a number field's arrows are. The keys stop there, so the editor's
// arrow nudge never moves the block meanwhile, and Delete and Backspace do
// nothing there (the editor's would remove the block).
//
// onChange(field, value, run): the field whose handle moved, its new value,
// and how to coalesce it.
//
// show: 'both', or 'first' or 'second' for one side alone (its partner hidden
// by its showIf): one handle on the same track, under that field's own label
// and hint, "10 pm" beside it, kept to its own range only (the hidden side
// does not apply meanwhile), the rail filled from the track's start to it.

// Numbered across the page, so a drag's key is never an earlier drag's (a
// component's own count would restart with the inspector, and a new drag
// could join the last one's undo step).
const nextDrag = (() => {
  let n = 0
  return () => (n += 1)
})()

const HANDLE_STEPS = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -3, PageUp: 3 }
const textOf = (v) => (typeof v === 'string' ? v : undefined)

export function HourRangeField({ first, second, firstValue, secondValue, show = 'both', onChange }) {
  const railRef = useRef(null)
  const firstRef = useRef(null)
  const secondRef = useRef(null)
  const drag = useRef(null)
  const [active, setActive] = useState(null)
  const track = hourRangeTrack(first, second)
  const { lo, hi, step } = track
  const a = Number.isFinite(firstValue) ? firstValue : track.first[0]
  const b = Number.isFinite(secondValue) ? secondValue : track.second[1]
  const values = { first: a, second: b }
  const fields = { first, second }
  const refs = { first: firstRef, second: secondRef }
  const both = show !== 'first' && show !== 'second'
  const handles = both ? ['first', 'second'] : [show]
  const label = both ? first.label || second.label || 'Hours' : fields[show].label || 'Hour'
  const hint = both ? (textOf(first.hint) ?? textOf(second.hint)) : textOf(fields[show].hint)
  const pct = (v) => ((clamp(v, lo, hi) - lo) / (hi - lo)) * 100
  // The other handle's value, which this one may not cross; none when alone.
  const other = (which) => (!both ? undefined : which === 'first' ? b : a)
  // What a handle may be set to now (its own range, one step off the other).
  const bounds = {
    first: [track.first[0], placeHandle(track, 'first', track.first[1], other('first'))],
    second: [placeHandle(track, 'second', track.second[0], other('second')), track.second[1]],
  }
  // Each handle named on its own: its field's label, unless the two share one.
  const same = (first.label || '') === (second.label || '')
  const names = both
    ? { first: same ? `${label} from` : first.label || `${label} from`, second: same ? `${label} to` : second.label || `${label} to` }
    : { [show]: label }

  function set(which, v, run) {
    const next = placeHandle(track, which, v, other(which))
    if (next !== values[which]) onChange(fields[which], next, run)
    return next
  }

  const valueAt = (clientX) => {
    const r = railRef.current.getBoundingClientRect()
    return lo + ((clientX - r.left) / Math.max(1, r.width)) * (hi - lo)
  }

  function nearest(v) {
    if (!both) return show
    if (v <= Math.min(a, b)) return a <= b ? 'first' : 'second'
    if (v >= Math.max(a, b)) return a <= b ? 'second' : 'first'
    return Math.abs(v - a) <= Math.abs(b - v) ? 'first' : 'second'
  }

  function follow(clientX) {
    const d = drag.current
    if (!d) return
    const next = placeHandle(track, d.which, valueAt(clientX) - d.offset, other(d.which))
    if (next === d.last) return
    d.last = next
    onChange(fields[d.which], next, d.run)
  }

  function onPointerDown(e) {
    if (e.button !== 0 || !railRef.current) return
    const hit = e.target instanceof Element ? e.target.closest('[data-handle]')?.getAttribute('data-handle') : null
    const at = valueAt(e.clientX)
    const which = handles.includes(hit) ? hit : nearest(at)
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // no capture: the drag still follows while the pointer is over the track
    }
    drag.current = {
      which,
      pointerId: e.pointerId,
      run: { key: `${fields[which].key}:drag${nextDrag()}`, windowMs: Infinity },
      // A handle grabbed off its centre does not jump to the pointer.
      offset: hit ? at - values[which] : 0,
      last: values[which],
    }
    setActive(which)
    refs[which].current?.focus({ preventScroll: true })
    if (!hit) follow(e.clientX)
  }

  function onPointerMove(e) {
    if (drag.current && e.pointerId === drag.current.pointerId) follow(e.clientX)
  }

  function endDrag(e) {
    const d = drag.current
    if (!d || (e && e.pointerId !== d.pointerId)) return
    drag.current = null
    setActive(null)
    try {
      e?.currentTarget?.releasePointerCapture?.(d.pointerId)
    } catch {
      // already released
    }
  }

  function onKeyDown(which, e) {
    const n = HANDLE_STEPS[e.key]
    let target
    if (n) target = values[which] + n * step * (e.shiftKey && Math.abs(n) === 1 ? 3 : 1)
    else if (e.key === 'Home') target = track[which][0]
    else if (e.key === 'End') target = track[which][1]
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      // Nothing to delete on a handle; on a native slider these never
      // reach the editor either, whose Delete would remove the block.
      e.preventDefault()
      e.stopPropagation()
      return
    } else return
    e.preventDefault()
    e.stopPropagation()
    set(which, target, fields[which].key)
  }

  const ticks = hourTicks(lo, hi)
  // The fill: between the handles, or from the track's start to a lone one.
  const left = both ? pct(Math.min(a, b)) : 0
  const right = both ? pct(Math.max(a, b)) : pct(values[show])
  return (
    <div className="ed-row ed-row--stack ed-hours">
      <FieldHead label={label} hint={hint} value={both ? hourRangeText(a, b) : hourLabel(values[show])} />
      <div
        className={`ed-hours__track${active ? ' is-dragging' : ''}`}
        role="group"
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <div className="ed-hours__rail" ref={railRef}>
          <span className="ed-hours__line" aria-hidden="true" />
          <span className="ed-hours__fill" aria-hidden="true" style={{ left: `${left}%`, width: `${right - left}%` }} />
          {ticks.map((t) => (
            <span key={t.h} className="ed-hours__mark" aria-hidden="true" style={{ left: `${pct(t.h)}%` }} />
          ))}
          {handles.map((which) => (
            <span
              key={which}
              ref={refs[which]}
              role="slider"
              tabIndex={0}
              data-handle={which}
              className={`ed-hours__thumb${active === which ? ' is-active' : ''}`}
              style={{ left: `${pct(values[which])}%` }}
              aria-label={names[which]}
              aria-orientation="horizontal"
              aria-valuemin={bounds[which][0]}
              aria-valuemax={bounds[which][1]}
              aria-valuenow={values[which]}
              aria-valuetext={hourLabel(values[which])}
              title={`${names[which]}: ${hourLabel(values[which])}`}
              onKeyDown={(e) => onKeyDown(which, e)}
            />
          ))}
        </div>
      </div>
      <div className="ed-hours__ticks" aria-hidden="true">
        {ticks.map((t, i) => (
          <span
            key={t.h}
            className={`ed-hours__tick${i === 0 ? ' is-start' : i === ticks.length - 1 ? ' is-end' : ''}`}
            style={{ left: `${pct(t.h)}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>
      {hint && hint.length > LONG_HINT && <small className="ed-row__hint">{hint}</small>}
    </div>
  )
}

// --- ui: 'timeList' -------------------------------------------------------------------
//
// A text field of 24-hour 'H:MM' times, comma-separated: a chip per time, in
// time order and in the house style ("7:30 am"), each with its remove button,
// then a time picker in quarter hours and Add time. A time already there is
// not added twice, and the list holds at most the field's `max` (8 when it
// does not say). Every add and remove writes the whole list normalised
// ('7:30,12:00'), one undo step each. A stored value that is not a time
// list shows as it is, with a warning and Reset (the field's default).
//
// A remove button takes Delete and Backspace too, and the focus stays in the
// list (the next chip, else the picker): left on the page, the next Delete
// would reach the editor and remove the whole block.

const QUARTER = 15

export function TimeListField({ field, value, onChange }) {
  const [pick, setPick] = useState('')
  const pickId = useId()
  const chipsRef = useRef(null)
  const pickRef = useRef(null)
  const refocus = useRef(null) // the chip index to focus once a removal has drawn
  const list = parseTimeList(typeof value === 'number' ? String(value) : value)
  const max = timeListMax(field)
  const hint = typeof field.hint === 'string' ? field.hint : undefined
  const label = field.label || 'Times'

  useLayoutEffect(() => {
    if (refocus.current == null) return
    const i = refocus.current
    refocus.current = null
    const buttons = chipsRef.current ? [...chipsRef.current.querySelectorAll('.ed-tchip__x')] : []
    ;(buttons[Math.min(i, buttons.length - 1)] || pickRef.current)?.focus()
  })

  if (list == null) {
    return (
      <div className="ed-row ed-row--stack ed-times is-invalid">
        <FieldHead label={label} hint={hint} />
        <code className="ed-times__raw" title="As stored">
          {String(value)}
        </code>
        <p className="ed-times__warn">
          <span>Not a list of times like 7:30,17:45.</span>
          <button type="button" className="ed-link" onClick={() => onChange(typeof field.default === 'string' ? field.default : '')}>
            Reset
          </button>
        </p>
      </div>
    )
  }

  const full = list.length >= max
  const picked = timeMinutes(pick)
  const offQuarter = picked != null && picked % QUARTER !== 0
  const duplicate = picked != null && list.includes(picked)
  const canAdd = picked != null && !offQuarter && !duplicate && !full
  // One line under the picker: why nothing can be added, the cap a quiet one.
  let note = null
  let quiet = false
  if (list.length > max) note = `More than ${max} (saved by hand): the screen shows ${max} of them. Remove ${list.length - max}.`
  else if (full) [note, quiet] = [`At most ${max} times; remove one to add another.`, true]
  else if (duplicate) note = `${timeLabel(timeText(picked))} is on the list already.`
  else if (offQuarter) note = 'Quarter hours only: :00, :15, :30 or :45.'

  function add() {
    if (!canAdd) return
    const r = addToTimeList(list, picked, max)
    if (!r.added) return
    onChange(timeListText(r.list))
    setPick('')
  }

  function remove(m, i) {
    refocus.current = i
    onChange(timeListText(list.filter((x) => x !== m)))
  }

  return (
    <div className="ed-row ed-row--stack ed-times">
      <FieldHead label={label} hint={hint} htmlFor={pickId} value={`${list.length} of ${max}`} />
      {list.length ? (
        <ul className="ed-times__chips" aria-label={label} ref={chipsRef}>
          {list.map((m, i) => {
            const text = timeLabel(timeText(m))
            return (
              <li key={m} className="ed-tchip">
                <span>{text}</span>
                <button
                  type="button"
                  className="ed-tchip__x"
                  aria-label={`Remove ${text}`}
                  title={`Remove ${text}`}
                  onClick={() => remove(m, i)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Delete' && e.key !== 'Backspace') return
                    e.preventDefault()
                    e.stopPropagation()
                    remove(m, i)
                  }}
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="ed-times__none">No times yet.</p>
      )}
      <div className="ed-times__add">
        <input
          ref={pickRef}
          id={pickId}
          type="time"
          className="ed-time"
          step={QUARTER * 60}
          value={pick}
          disabled={full}
          aria-label={`${label}: a time to add`}
          onChange={(e) => setPick(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="ed-btn" disabled={!canAdd} onClick={add}>
          Add time
        </button>
      </div>
      {note && <p className={`ed-times__note${quiet ? '' : ' is-warn'}`}>{note}</p>}
      {hint && hint.length > LONG_HINT && <small className="ed-row__hint">{hint}</small>}
    </div>
  )
}
