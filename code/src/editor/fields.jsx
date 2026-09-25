// fields.jsx - the inspector's controls. Plain inputs, compact, keyboard
// friendly: number fields commit on Enter or blur (Esc cancels) and step with
// the arrow keys (Shift x10); sliders and colour pickers report every value
// and the caller coalesces them into one undo step.

import { useId, useRef, useState } from 'react'
import { optionValue } from './schema.js'
import { clamp, colorForWell, decimalsOf } from './util.js'

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
const LONG_HINT = 30
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
export function ColorField({ value, onChange, onCommit, label }) {
  const id = useId()
  return (
    <Row label={label} htmlFor={id}>
      <div className="ed-color">
        <input id={id} type="color" value={colorForWell(value)} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        <TextField value={value} ariaLabel={`${label} hex`} onCommit={(v) => (onCommit || onChange)(v)} />
      </div>
    </Row>
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
// segmented or a dropdown, toggle, color = a swatch and its hex, text = an
// input, or a textarea when the field is multiline.
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
      return <ColorField label={field.label} value={typeof value === 'string' ? value : ''} onChange={onChange} />
    case 'text':
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
