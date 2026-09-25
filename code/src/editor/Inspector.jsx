// Inspector - the right-hand column. With a selection: its position and size
// in canvas pixels, the universal props, and a block's own (text, image).
// Without one: the screen's Entry backdrop and the global text scale.
//
// Every change goes up as a draft edit; nothing here talks to the hub.

import { useEffect, useRef } from 'react'
import { ColorField, NumberField, Row, Segmented, SliderField, TextField, Toggle } from './fields.jsx'
import { hubUrl } from './hub.js'
import { BACKDROP_DIM_MAX, RANGES, TYPE_LABELS, WEIGHTS, minPctFor, pctToPxRound } from './spec.js'

const ALIGN_OPTIONS = [
  ['start', 'Left', 'Align to the start'],
  ['center', 'Centre', 'Centre'],
  ['end', 'Right', 'Align to the end'],
]
const BG_OPTIONS = [
  ['none', 'None', 'No background'],
  ['card', 'Card', 'Translucent card'],
  ['solid', 'Solid', 'Solid card'],
]
const WEIGHT_NAMES = { 300: 'Light', 400: 'Regular', 600: 'Semibold', 700: 'Bold' }
const WEIGHT_OPTIONS = WEIGHTS.map((w) => [w, String(w), WEIGHT_NAMES[w]])
const FIT_OPTIONS = [
  ['contain', 'Contain', 'Whole picture, letterboxed'],
  ['cover', 'Cover', 'Fill the box, cropped'],
]

export default function Inspector(props) {
  const { draft, panel } = props
  return (
    <aside className="ed-inspector" aria-label="Inspector">
      {!draft ? (
        <div className="ed-side__empty">Loading the layout…</div>
      ) : panel ? (
        <PanelInspector {...props} />
      ) : (
        <NoSelection {...props} />
      )}
    </aside>
  )
}

function PanelInspector({ panel, canvas, labels, mins, art, onRefreshArt, onBox, onProps, onPanel, onRemove, focusTextSeq }) {
  const id = panel.id
  const pr = panel.props
  const px = pctToPxRound(panel, canvas)
  const min = minPctFor(panel.type, mins)
  const minW = Math.ceil((min.w * canvas.w) / 100)
  const minH = Math.ceil((min.h * canvas.h) / 100)
  const isBlock = panel.type === 'text' || panel.type === 'image'
  const title = labels?.[panel.type] || TYPE_LABELS[panel.type] || panel.type
  const set = (patch, field) => onProps(id, patch, field)

  return (
    <div className="ed-insp">
      <header className="ed-insp__head">
        <div className="ed-insp__title">
          <strong>{title}</strong>
          <code>{id}</code>
        </div>
        {isBlock ? (
          <button type="button" className="ed-btn ed-btn--danger" onClick={() => onRemove(id)} title="Delete this block (Delete)">
            Delete
          </button>
        ) : (
          <button type="button" className="ed-btn" onClick={() => onPanel(id, { hidden: !panel.hidden })} title="Hide or show this panel (Delete hides)">
            {panel.hidden ? 'Show' : 'Hide'}
          </button>
        )}
      </header>

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

      {panel.type === 'text' && <TextProps panel={panel} canvas={canvas} set={set} focusTextSeq={focusTextSeq} />}
      {panel.type === 'image' && <ImageProps panel={panel} art={art} onRefreshArt={onRefreshArt} set={set} />}

      <section className="ed-sec">
        <h3>Appearance</h3>
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
        <SliderField
          label="Corner radius"
          value={pr.radius}
          min={RANGES.radius[0]}
          max={RANGES.radius[1]}
          step={0.25}
          suffix="x"
          onChange={(v) => set({ radius: v }, 'radius')}
        />
        {panel.type !== 'text' && (
          <Row label="Align">
            <Segmented ariaLabel="Align" options={ALIGN_OPTIONS} value={pr.align} onChange={(v) => set({ align: v })} />
          </Row>
        )}
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
    </div>
  )
}

function TextProps({ panel, canvas, set, focusTextSeq }) {
  const pr = panel.props
  const textRef = useRef(null)
  // A double-click on the block (or Enter on the stage) asks for the text.
  useEffect(() => {
    if (!focusTextSeq) return
    const el = textRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [focusTextSeq])

  return (
    <section className="ed-sec">
      <h3>Text</h3>
      <textarea
        ref={textRef}
        className="ed-textarea"
        rows={3}
        maxLength={2000}
        spellCheck
        aria-label="Text"
        value={pr.text}
        onChange={(e) => set({ text: e.target.value }, 'text')}
      />
      <SliderField
        label="Size"
        hint={`% of the height, ${Math.round((pr.size * canvas.h) / 100)} px`}
        value={pr.size}
        min={1}
        max={20}
        fieldMin={RANGES.size[0]}
        fieldMax={RANGES.size[1]}
        step={0.1}
        digits={2}
        suffix="%"
        onChange={(v) => set({ size: v }, 'size')}
      />
      <Row label="Weight">
        <Segmented ariaLabel="Weight" options={WEIGHT_OPTIONS} value={pr.weight} onChange={(v) => set({ weight: v })} />
      </Row>
      <ColorField label="Colour" value={pr.color} onChange={(v) => set({ color: v }, 'color')} />
      <Row label="Align">
        <Segmented ariaLabel="Align" options={ALIGN_OPTIONS} value={pr.align} onChange={(v) => set({ align: v })} />
      </Row>
      <SliderField
        label="Line height"
        value={pr.lineHeight}
        min={RANGES.lineHeight[0]}
        max={2.5}
        fieldMax={RANGES.lineHeight[1]}
        step={0.05}
        onChange={(v) => set({ lineHeight: v }, 'lineHeight')}
      />
    </section>
  )
}

function ImageProps({ panel, art, onRefreshArt, set }) {
  const pr = panel.props
  const items = art?.items || []
  return (
    <section className="ed-sec">
      <h3>Image</h3>
      <div className="ed-art__head">
        <span>Countdown Art</span>
        <button type="button" className="ed-link" onClick={onRefreshArt}>
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
              aria-selected={pr.src === it.url}
              className={pr.src === it.url ? 'is-on' : undefined}
              title={it.name}
              onClick={() => set({ src: it.url })}
            >
              <img src={hubUrl(it.url)} alt={it.name} loading="lazy" draggable={false} />
            </button>
          ))}
        </div>
      )}
      <Row label="URL" hint="or https://…">
        <TextField value={pr.src} ariaLabel="Image URL" placeholder="/countdown-art/… or https://…" onCommit={(v) => set({ src: v })} />
      </Row>
      <Row label="Fit">
        <Segmented ariaLabel="Fit" options={FIT_OPTIONS} value={pr.fit} onChange={(v) => set({ fit: v })} />
      </Row>
    </section>
  )
}

function NoSelection({ draft, onBackdrop, onGlobal }) {
  const bd = draft.backdrop
  const photos = bd.entryBackdrop !== 'black'
  return (
    <div className="ed-insp">
      <header className="ed-insp__head">
        <div className="ed-insp__title">
          <strong>Entry board</strong>
          <code>nothing selected</code>
        </div>
      </header>
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
        <p className="ed-note">The screen's own Entry board settings (the dashboard's card shows the same two). Saved with the layout.</p>
      </section>
      <section className="ed-sec">
        <h3>Global</h3>
        <SliderField
          label="Text scale"
          hint="Multiplies every panel's"
          value={draft.spec.global.textScale}
          min={RANGES.globalTextScale[0]}
          max={RANGES.globalTextScale[1]}
          step={0.05}
          suffix="x"
          onChange={(v) => onGlobal({ textScale: v }, 'textScale')}
        />
      </section>
      <section className="ed-sec ed-keys">
        <h3>Keys</h3>
        <dl>
          <dt>Click</dt>
          <dd>select (the frontmost)</dd>
          <dt>Drag</dt>
          <dd>move; Shift keeps one axis</dd>
          <dt>Handles</dt>
          <dd>resize; Shift keeps the aspect</dd>
          <dt>Option</dt>
          <dd>ignore the grid while dragging</dd>
          <dt>Arrows</dt>
          <dd>nudge 1 px, Shift 10 px</dd>
          <dt>Delete</dt>
          <dd>hide a panel, remove a block</dd>
          <dt>Esc</dt>
          <dd>deselect, or cancel a drag</dd>
          <dt>⌘Z  ⇧⌘Z</dt>
          <dd>undo, redo</dd>
          <dt>⌘S</dt>
          <dd>save</dd>
        </dl>
      </section>
    </div>
  )
}
