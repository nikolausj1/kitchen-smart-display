// Inspector - the right-hand column.
//
// A panel selected: its position and size in canvas pixels, the universal
// props (appearance, state), then its own knobs, rendered from the panel
// type's schema (schema.js) and grouped by the sub-element each one tunes
// (Clock: Time, Date, Greeting). With a sub-element selected on the stage the
// header reads "Clock › Date" and that group is scrolled to and marked.
// Hovering a field tells the app which element it affects (onFieldHover).
//
// Nothing selected: the screen's Entry backdrop (Entry only), the layout's
// global knobs (from the global schema, plus the text scale) and, on the
// Entry board, the hour the Evening variant starts.
//
// A day part with no layout of its own: the offer to create one from Day.
//
// Every change goes up as a draft edit; nothing here talks to the hub.

import { useEffect, useRef } from 'react'
import { NumberField, Row, SchemaField, Segmented, SelectField, SliderField, Toggle } from './fields.jsx'
import { hubUrl } from './hub.js'
import { declares, elementLabel, fieldValue, globalFields, groupFields, knobFields } from './schema.js'
import {
  BACKDROP_DIM_MAX,
  DAYPART_LABELS,
  EVENING_DEFAULT,
  EVENING_RANGE,
  RANGES,
  layoutMeta,
  minPctFor,
  partGlobal,
  partHasOwnGlobal,
  partWhen,
  pctToPxRound,
  typeLabel,
} from './spec.js'
import { deepEqual } from './util.js'

const ALIGN_OPTIONS = [
  ['start', 'Left', 'Align to the start'],
  ['center', 'Centre', 'Centre'],
  ['end', 'Right', 'Align to the end'],
]
// Fields whose changes arrive as a stream (a slider, a colour well, typing):
// one undo step per run, not per value.
const CONTINUOUS = ['number', 'color', 'text']
const BG_OPTIONS = [
  ['none', 'None', 'No background'],
  ['card', 'Card', 'Translucent card'],
  ['solid', 'Solid', 'Solid card'],
]
// The universal scrim: a shade behind a box with no background, bleeding past
// its edges, plus a close text shadow (Entry/SpecPanel.css).
const SCRIM_OPTIONS = [
  ['none', 'None', 'No shade behind the text'],
  ['soft', 'Soft', 'A soft shade behind the box and past its edges, and a faint text shadow'],
  ['strong', 'Strong', 'A stronger shade and text shadow'],
]

export default function Inspector(props) {
  const { draft, panel, hasVariant, onFieldHover } = props
  return (
    <aside className="ed-inspector" aria-label="Inspector" onMouseLeave={() => onFieldHover(null)}>
      {!draft ? (
        <div className="ed-side__empty">Loading the layout…</div>
      ) : !hasVariant ? (
        <PartPrompt {...props} />
      ) : panel ? (
        <PanelInspector key={panel.id} {...props} />
      ) : (
        <NoSelection {...props} />
      )}
    </aside>
  )
}

// A field row that tells the app what it tunes while the pointer is on it.
function Hover({ id, element, onFieldHover, children }) {
  return (
    <div
      className="ed-hoverable"
      onMouseEnter={() => onFieldHover({ id, element: element || null })}
      onMouseLeave={() => onFieldHover({ id, element: null })}
    >
      {children}
    </div>
  )
}

function PanelInspector({
  panel,
  canvas,
  labels,
  mins,
  art,
  onRefreshArt,
  onBox,
  onProps,
  onPanel,
  onRemove,
  onResetKnobs,
  focusTextFor,
  onTextFocused,
  selectedElement,
  onSelectElement,
  reportedLabels,
  onFieldHover,
}) {
  const id = panel.id
  const pr = panel.props
  const px = pctToPxRound(panel, canvas)
  const min = minPctFor(panel.type, mins)
  const minW = Math.ceil((min.w * canvas.w) / 100)
  const minH = Math.ceil((min.h * canvas.h) / 100)
  const isBlock = panel.type === 'text' || panel.type === 'image'
  const title = typeLabel(panel.type, labels)
  const set = (patch, field) => onProps(id, patch, field)
  const fields = knobFields(panel.type)
  const groups = groupFields(panel.type, fields, reportedLabels)
  const elLabel = selectedElement ? elementLabel(panel.type, selectedElement, reportedLabels) : ''
  const hasGroup = !!selectedElement && groups.some((g) => g.element === selectedElement)
  const knobsAtDefault = fields.every((f) => f.default === undefined || fieldValue(f, pr) === f.default)
  const uni = (key) => !declares(panel.type, key)

  // The selected sub-element's group, into view.
  const rootRef = useRef(null)
  useEffect(() => {
    if (!selectedElement) return
    const el = rootRef.current?.querySelector(`[data-element="${CSS.escape(selectedElement)}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedElement])

  // A double-click on a text block, Enter on the stage or Add text asks for
  // its text: one request, consumed here.
  const textRef = useRef(null)
  useEffect(() => {
    if (focusTextFor !== id) return
    const el = textRef.current
    if (el) {
      el.focus()
      el.select()
    }
    onTextFocused()
  }, [focusTextFor, id, onTextFocused])

  return (
    <div className="ed-insp" ref={rootRef}>
      <header className="ed-insp__head">
        <div className="ed-insp__title">
          <nav className="ed-crumbs" aria-label="Selection">
            {selectedElement ? (
              <>
                <button type="button" className="ed-crumb" onClick={() => onSelectElement(null)} title="Back to the panel (Esc)">
                  {title}
                </button>
                <span className="ed-crumb__sep" aria-hidden="true">
                  ›
                </span>
                <strong aria-current="true">{elLabel}</strong>
              </>
            ) : (
              <strong>{title}</strong>
            )}
          </nav>
          <code>{id}</code>
        </div>
        <div className="ed-insp__actions">
          {isBlock ? (
            <button type="button" className="ed-btn ed-btn--danger" onClick={() => onRemove(id)} title="Delete this block (Delete)">
              Delete
            </button>
          ) : (
            <>
              {panel.hidden && (
                <button
                  type="button"
                  className="ed-btn ed-btn--danger"
                  onClick={() => onRemove(id)}
                  title="Take this panel off the layout; Add panel brings it back"
                >
                  Remove from layout
                </button>
              )}
              <button type="button" className="ed-btn" onClick={() => onPanel(id, { hidden: !panel.hidden })} title="Hide or show this panel (Delete hides)">
                {panel.hidden ? 'Show' : 'Hide'}
              </button>
            </>
          )}
        </div>
      </header>
      {selectedElement && !hasGroup && (
        <p className="ed-note ed-insp__note">{elLabel} has no settings of its own; the panel's are below.</p>
      )}

      <section className="ed-sec">
        <h3>Position and size</h3>
        <div className="ed-box4">
          <NumberField prefix="X" value={px.x} min={0} max={canvas.w - px.w} onCommit={(v) => onBox(id, 'x', v)} />
          <NumberField prefix="Y" value={px.y} min={0} max={canvas.h - px.h} onCommit={(v) => onBox(id, 'y', v)} />
          <NumberField prefix="W" value={px.w} min={minW} max={canvas.w - px.x} onCommit={(v) => onBox(id, 'w', v)} />
          <NumberField prefix="H" value={px.h} min={minH} max={canvas.h - px.y} onCommit={(v) => onBox(id, 'h', v)} />
        </div>
        <p className="ed-note">
          Canvas pixels on {canvas.w} x {canvas.h}; saved as percent ({panel.x}, {panel.y}, {panel.w} x {panel.h}), so the
          layout follows the screen.
        </p>
      </section>

      <section className="ed-sec">
        <h3>Appearance</h3>
        <Hover id={id} onFieldHover={onFieldHover}>
          <SliderField
            label="Text scale"
            value={pr.textScale}
            min={RANGES.textScale[0]}
            max={RANGES.textScale[1]}
            step={0.05}
            suffix="x"
            onChange={(v) => set({ textScale: v }, 'textScale')}
          />
          <SliderField
            label="Opacity"
            value={pr.opacity}
            min={RANGES.opacity[0]}
            max={RANGES.opacity[1]}
            step={0.05}
            scale={100}
            digits={0}
            suffix="%"
            onChange={(v) => set({ opacity: v }, 'opacity')}
          />
          <SliderField
            label="Padding"
            value={pr.padding}
            min={RANGES.padding[0]}
            max={RANGES.padding[1]}
            step={0.25}
            suffix="x"
            onChange={(v) => set({ padding: v }, 'padding')}
          />
          <Row label="Background">
            <Segmented ariaLabel="Background" options={BG_OPTIONS} value={pr.background} onChange={(v) => set({ background: v })} />
          </Row>
          <Row label="Scrim" hint={pr.background === 'none' ? 'Shade behind bare text' : 'Only with no background'}>
            <Segmented
              ariaLabel="Scrim"
              options={SCRIM_OPTIONS}
              value={pr.scrim ?? 'none'}
              disabled={pr.background !== 'none'}
              onChange={(v) => set({ scrim: v })}
            />
          </Row>
          <SliderField
            label="Corner radius"
            value={pr.radius}
            min={RANGES.radius[0]}
            max={RANGES.radius[1]}
            step={0.25}
            suffix="x"
            onChange={(v) => set({ radius: v }, 'radius')}
          />
          {uni('align') && (
            <Row label="Align">
              <Segmented ariaLabel="Align" options={ALIGN_OPTIONS} value={pr.align} onChange={(v) => set({ align: v })} />
            </Row>
          )}
        </Hover>
      </section>

      <section className="ed-sec">
        <h3>State</h3>
        <Row label="Visible">
          <Toggle ariaLabel="Visible" checked={!panel.hidden} onChange={(on) => onPanel(id, { hidden: !on })} />
        </Row>
        <Row label="Locked" hint="No dragging or resizing">
          <Toggle ariaLabel="Locked" checked={panel.locked} onChange={(on) => onPanel(id, { locked: on })} />
        </Row>
      </section>

      {(fields.length > 0 || panel.type === 'image') && (
        <section className="ed-sec ed-knobs" aria-label={`${title} settings`}>
          <div className="ed-sec__head">
            <h3>{isBlock ? title : `${title} settings`}</h3>
            {!isBlock && fields.length > 0 && (
              <button
                type="button"
                className="ed-link"
                disabled={knobsAtDefault}
                onClick={() => onResetKnobs(id)}
                title="Every setting in this section back to its default"
              >
                Reset knobs
              </button>
            )}
          </div>
          {panel.type === 'image' && <ArtPicker src={pr.src} art={art} onRefresh={onRefreshArt} onPick={(url) => set({ src: url })} />}
          {groups.map((g) => (
            <div
              key={g.element ?? '-'}
              className={`ed-knobgroup${g.element && g.element === selectedElement ? ' is-focus' : ''}`}
              data-element={g.element ?? undefined}
            >
              {g.label && (
                <h4>
                  {g.element ? (
                    <button type="button" className="ed-knobgroup__name" onClick={() => onSelectElement(g.element)} title="Select it on the stage">
                      {g.label}
                    </button>
                  ) : (
                    g.label
                  )}
                </h4>
              )}
              {g.fields.map((f) => (
                <Hover key={f.key} id={id} element={g.element} onFieldHover={onFieldHover}>
                  <SchemaField
                    field={f}
                    value={fieldValue(f, pr)}
                    textRef={panel.type === 'text' && f.key === 'text' ? textRef : undefined}
                    onChange={(v) => set({ [f.key]: v }, CONTINUOUS.includes(f.type) ? f.key : undefined)}
                  />
                </Hover>
              ))}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function ArtPicker({ src, art, onRefresh, onPick }) {
  const items = art?.items || []
  return (
    <div className="ed-artpick">
      <div className="ed-art__head">
        <span>Countdown Art</span>
        <button type="button" className="ed-link" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      {art?.error ? (
        <p className="ed-note ed-note--warn">Could not load the art list: {art.error}</p>
      ) : !art ? (
        <p className="ed-note">Loading…</p>
      ) : items.length === 0 ? (
        <p className="ed-note">No pictures in the Countdown Art album yet.</p>
      ) : (
        <div className="ed-art" role="listbox" aria-label="Countdown Art">
          {items.map((it) => (
            <button
              key={it.file}
              type="button"
              role="option"
              aria-selected={src === it.url}
              className={src === it.url ? 'is-on' : undefined}
              title={it.name}
              onClick={() => onPick(it.url)}
            >
              <img src={hubUrl(it.url)} alt={it.name} loading="lazy" draggable={false} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function EveningFrom({ spec, onEveningFrom }) {
  const hours = []
  for (let h = EVENING_RANGE[0]; h <= EVENING_RANGE[1]; h++) hours.push([h, `${h}:00`])
  const value = spec.eveningFrom ?? EVENING_DEFAULT
  const hasEvening = !!spec.variants?.evening
  return (
    <section className="ed-sec">
      <h3>Layout</h3>
      <Row label="Evening from" hint={hasEvening ? 'Until midnight' : 'Used once there is an Evening'}>
        <SelectField ariaLabel="Evening from" options={hours} value={value} onChange={(h) => onEveningFrom(h)} />
      </Row>
    </section>
  )
}

function GlobalSection({ spec, part, defaultGlobal, onGlobal, onResetGlobal, onFollowDay }) {
  const g = partGlobal(spec, part) || {}
  const own = partHasOwnGlobal(spec, part)
  const fields = globalFields()
  const isDefault = part === 'day' && !!defaultGlobal && deepEqual(spec.global, defaultGlobal)
  return (
    <section className="ed-sec">
      <div className="ed-sec__head">
        <h3>Global</h3>
        {part === 'day' ? (
          <button type="button" className="ed-link" disabled={isDefault} onClick={onResetGlobal} title="The layout's own font, colours and sizes">
            Reset
          </button>
        ) : (
          own && (
            <button type="button" className="ed-link" onClick={onFollowDay} title={`Drop ${DAYPART_LABELS[part]}'s own global settings`}>
              Follow Day
            </button>
          )
        )}
      </div>
      {part !== 'day' && (
        <p className="ed-note ed-note--top">
          {own
            ? `${DAYPART_LABELS[part]} has its own global settings.`
            : `${DAYPART_LABELS[part]} follows Day's; a change here gives it its own.`}
        </p>
      )}
      {fields.map((f) => (
        <SchemaField
          key={f.key}
          field={f}
          value={g[f.key] ?? defaultGlobal?.[f.key] ?? f.default}
          onChange={(v) => onGlobal({ [f.key]: v }, CONTINUOUS.includes(f.type) ? f.key : undefined)}
        />
      ))}
    </section>
  )
}

function NoSelection({ draft, spec, part, layoutId, defaultGlobal, onBackdrop, onGlobal, onResetGlobal, onFollowDay, onEveningFrom }) {
  const bd = draft.backdrop
  const photos = bd.entryBackdrop !== 'black'
  const meta = layoutMeta(layoutId)
  return (
    <div className="ed-insp">
      <header className="ed-insp__head">
        <div className="ed-insp__title">
          <strong>
            {meta.label}
            {meta.variants ? ` · ${DAYPART_LABELS[part]}` : ''}
          </strong>
          <code>nothing selected</code>
        </div>
      </header>
      {meta.backdrop && (
        <section className="ed-sec">
          <h3>Backdrop</h3>
          <Row label="Photos behind the board" hint="Off is plain black">
            <Toggle
              ariaLabel="Photos behind the board"
              checked={photos}
              onChange={(on) => onBackdrop({ entryBackdrop: on ? 'photos' : 'black' })}
            />
          </Row>
          <SliderField
            label="Darken photos"
            value={bd.entryDim}
            min={0}
            max={BACKDROP_DIM_MAX}
            step={0.05}
            scale={100}
            digits={0}
            suffix="%"
            disabled={!photos}
            onChange={(v) => onBackdrop({ entryDim: v }, 'dim')}
          />
          <p className="ed-note">The screen's own Entry board settings (the dashboard's card shows the same two), for every day part. Saved with the layout.</p>
        </section>
      )}
      <GlobalSection
        spec={spec}
        part={part}
        defaultGlobal={defaultGlobal}
        onGlobal={onGlobal}
        onResetGlobal={onResetGlobal}
        onFollowDay={onFollowDay}
      />
      {meta.variants && <EveningFrom spec={spec} onEveningFrom={onEveningFrom} />}
      <Keys />
    </div>
  )
}

function PartPrompt({ spec, part, layoutId, onCreatePart, onEveningFrom }) {
  const name = DAYPART_LABELS[part]
  return (
    <div className="ed-insp">
      <header className="ed-insp__head">
        <div className="ed-insp__title">
          <strong>
            {layoutMeta(layoutId).label} · {name}
          </strong>
          <code>no layout of its own</code>
        </div>
      </header>
      <section className="ed-sec">
        <p className="ed-prompt">
          {name} has no layout of its own, so the screen shows the Day layout {partWhen(part, spec.eveningFrom)} too.
        </p>
        <button type="button" className="ed-btn ed-btn--primary" onClick={onCreatePart}>
          Create {name} from Day
        </button>
        <p className="ed-note">A copy of the Day layout to change freely. Remove it later to go back to Day.</p>
      </section>
      {part === 'evening' && <EveningFrom spec={spec} onEveningFrom={onEveningFrom} />}
    </div>
  )
}

function Keys() {
  return (
    <section className="ed-sec ed-keys">
      <h3>Keys</h3>
      <dl>
        <dt>Click</dt>
        <dd>select (the frontmost); again for a part of it</dd>
        <dt>Drag</dt>
        <dd>move; Shift keeps one axis</dd>
        <dt>Handles</dt>
        <dd>resize; Shift keeps the aspect</dd>
        <dt>Option</dt>
        <dd>ignore the grid and the guides while dragging</dd>
        <dt>Arrows</dt>
        <dd>nudge 1 px, Shift 10 px</dd>
        <dt>Delete</dt>
        <dd>hide a panel, remove a block</dd>
        <dt>Esc</dt>
        <dd>up a level: part, panel, nothing; or cancel a drag</dd>
        <dt>⌘Z  ⇧⌘Z</dt>
        <dd>undo, redo</dd>
        <dt>⌘S</dt>
        <dd>save</dd>
      </dl>
    </section>
  )
}
