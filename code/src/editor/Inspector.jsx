// Inspector - the right-hand column.
//
// A panel selected: its position and size in canvas pixels, the universal
// props (appearance, state), the box v2 props (fill, border, shadow, blur,
// font, text colour, vertical align, block title; drawn from the box schema),
// when it shows (its visibility rule), then its own knobs, rendered from the
// panel type's schema (schema.js) and grouped by the sub-element each one
// tunes (Clock: Time, Date, Greeting). The header's menu copies and pastes the
// panel's style.
//
// A sub-element selected on the stage or in the layers: the header reads
// "Countdowns › Tile › Title", an Element section on top styles that element
// alone (drawn from the element style schema: hidden, size, weight, colour,
// space, letter spacing, capitals, fit), and the panel's own knobs for it are
// scrolled to and marked below. Hovering a field tells the app which element
// it affects (onFieldHover).
//
// Blocks come from the app's type list (schema.js): text and image show their
// content (the text, the picture), a shape its own knobs (Shape, Fill) under
// "Shape settings". In the UI every panel is a block: the header names it as
// the layers do ("Weather 2") and has Hide (or Show) and Delete for all of
// them; Delete takes it off the layout (one undo step). The Type
// section (font, text colour, vertical align) is for boxes with words of
// their own: a type whose only element is its title (the shape) goes without
// it, and its title takes an element style like any other.
//
// A panel of a type the app does not know: what it is, that it is kept as
// saved, and Delete. Nothing else: the editor cannot know what it may hold.
//
// Every list of schema fields (a type's knobs, the element style, the global
// knobs) is drawn by FieldList: a field shows only while its `showIf` holds
// (read from the current values with the defaults filled in; a hidden field
// keeps its value), an hourRange pair is one slider with two handles, a
// timeList is chips (schema.js, the field vocabulary). A knob group whose
// fields are all hidden is not drawn; with its element selected, a note says
// which setting hides them. The box fields take `showIf` too.
//
// Several panels selected: what they are, and pasting a style onto all.
//
// Nothing selected: the screen's Entry backdrop (Entry only), the layout's
// global knobs (from the global schema, plus the text scale) and, on the
// Entry board, the hour the Evening variant starts.
//
// A day part with no layout of its own: the offer to create one from Day.
//
// Every change goes up as a draft edit; nothing here talks to the hub.

import { Fragment, useEffect, useRef } from 'react'
import { HourRangeField, NumberField, Row, SchemaField, Segmented, SelectField, SliderField, TextField, TimeField, Toggle } from './fields.jsx'
import { hubUrl } from './hub.js'
import { MoreIcon } from './icons.jsx'
import { Menu, MenuItem, MenuNote } from './menus.jsx'
import {
  boxFieldsFor,
  declares,
  elementLabel,
  elementList,
  elementStyleFields,
  fieldValue,
  globalFields,
  groupFields,
  hasOwnProps,
  hiddenBecause,
  hourRangeDraw,
  hourRangePairs,
  isKnownType,
  knobFields,
  ruleKind,
  ruleKinds,
  showIfHolds,
  shownFields,
  valueReader,
} from './schema.js'
import {
  BACKDROP_DIM_MAX,
  DAYPART_LABELS,
  EVENING_DEFAULT,
  EVENING_RANGE,
  MAX_CONDITIONS,
  RANGES,
  blockName,
  cleanBoxValue,
  elementStyleOf,
  isStyled,
  layoutMeta,
  minPctFor,
  panelLabel,
  partGlobal,
  partHasOwnGlobal,
  partWhen,
  pctToPxRound,
  styleValue,
  styledCount,
  typeLabel,
  whenConditions,
  whenMode,
} from './spec.js'
import { deepEqual, getPath } from './util.js'

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
  const { draft, panel, group, hasVariant, onFieldHover } = props
  return (
    <aside className="ed-inspector" aria-label="Inspector" onMouseLeave={() => onFieldHover(null)}>
      {!draft ? (
        <div className="ed-side__empty">Loading the layout…</div>
      ) : !hasVariant ? (
        <PartPrompt {...props} />
      ) : group && group.length > 1 ? (
        <GroupInspector {...props} />
      ) : panel && !isKnownType(panel.type) ? (
        <UnsupportedInspector key={panel.id} {...props} />
      ) : panel ? (
        <PanelInspector key={panel.id} {...props} />
      ) : (
        <NoSelection {...props} />
      )}
    </aside>
  )
}

// Fields whose changes arrive as a stream get one undo step per run; a time
// list's adds and removes are one step each.
const coalesceFor = (f) => (f.type === 'text' && f.ui === 'timeList' ? undefined : CONTINUOUS.includes(f.type) ? f.key : undefined)

// How a change coalesces: undefined (its own undo step), a key (a run of
// changes a moment apart), or { key, windowMs } (an hourRange drag: all of it,
// however long it takes).
const runKey = (run) => (run && typeof run === 'object' ? run.key : run)
const runWindow = (run) => (run && typeof run === 'object' ? run.windowMs : undefined)

// A list of schema fields, those to draw (shownFields: showIf held, a pair
// at its first field), each as its control: an hourRange pair as one slider
// (two handles, or one when the other side is hidden), any other as
// SchemaField. read(key): a value, defaults filled in. onChange(field, value,
// run). wrap(field, node): what goes round each (the hover that marks what it
// tunes).
function FieldList({ fields, pairs, read, onChange, wrap, textRefFor }) {
  return fields.map((f) => {
    const hr = hourRangeDraw(f, pairs, read)
    const node = hr ? (
      <HourRangeField
        first={hr.first}
        second={hr.second}
        show={hr.show}
        firstValue={read(hr.first.key)}
        secondValue={read(hr.second.key)}
        onChange={onChange}
      />
    ) : (
      <SchemaField field={f} value={read(f.key)} textRef={textRefFor ? textRefFor(f) : undefined} onChange={(v) => onChange(f, v, coalesceFor(f))} />
    )
    return <Fragment key={f.key}>{wrap ? wrap(f, node) : node}</Fragment>
  })
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
  part,
  canvas,
  labels,
  names,
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
  elementPath,
  onSelectElement,
  reportedLabels,
  onFieldHover,
  onElementStyle,
  onResetElement,
  onResetElements,
  onBoxProp,
  onWhen,
  styleClip,
  onCopyStyle,
  onPasteStyle,
}) {
  const id = panel.id
  const pr = panel.props
  const px = pctToPxRound(panel, canvas)
  const min = minPctFor(panel.type, mins)
  const minW = Math.ceil((min.w * canvas.w) / 100)
  const minH = Math.ceil((min.h * canvas.h) / 100)
  // Text and image: their fields are their content, the section is theirs.
  // Everything else (a shape, a panel): settings, with Reset knobs.
  const ownProps = hasOwnProps(panel.type)
  // The type's name heads its settings ("Weather settings"); the block's own
  // name ("Weather 2") heads the inspector.
  const title = typeLabel(panel.type, labels)
  const name = blockName(panel, labels, names)
  const set = (patch, run) => onProps(id, patch, runKey(run), runWindow(run))
  const fields = knobFields(panel.type)
  // A picture to pick: the image block's src.
  const hasSrc = fields.some((f) => f.key === 'src')
  // The knobs on show: their showIf read from the knobs as they are now, the
  // defaults filled in; an hourRange partner goes with its first.
  const read = valueReader(fields, pr)
  const pairs = hourRangePairs(fields)
  const groups = groupFields(panel.type, shownFields(fields, read, pairs), reportedLabels)
  const elLabel = selectedElement ? elementLabel(panel.type, selectedElement, reportedLabels) : ''
  const hasGroup = !!selectedElement && groups.some((g) => g.element === selectedElement)
  // The selected element's own knobs, when every one is hidden by another
  // knob's value: which, and what it is set to ("Show is Whole day").
  const hiddenWhy = selectedElement && !hasGroup ? hiddenBecause(fields.filter((f) => f.element === selectedElement), fields, read) : []
  const knobsAtDefault = fields.every((f) => f.default === undefined || fieldValue(f, pr) === f.default)
  const uni = (key) => !declares(panel.type, key)
  const styled = styledCount(panel)
  // The breadcrumb between the panel and the element: the elements it sits in.
  const between = (elementPath || []).slice(0, -1)

  // A sub-element selected: the inspector back to its top, where the
  // Element section is; the panel's own settings for it are marked below and
  // one click away (showKnobs).
  const rootRef = useRef(null)
  useEffect(() => {
    if (!selectedElement) return
    rootRef.current?.closest('.ed-inspector')?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [selectedElement])
  const showKnobs = () => {
    const el = rootRef.current?.querySelector(`[data-element="${CSS.escape(selectedElement)}"]`)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

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
                <button type="button" className="ed-crumb" onClick={() => onSelectElement(null)} title="Back to the block (Esc)">
                  {name}
                </button>
                {between.map((key) => (
                  <span key={key} className="ed-crumb__step">
                    <span className="ed-crumb__sep" aria-hidden="true">
                      ›
                    </span>
                    <button type="button" className="ed-crumb" onClick={() => onSelectElement(key)} title="Select it">
                      {elementLabel(panel.type, key, reportedLabels)}
                    </button>
                  </span>
                ))}
                <span className="ed-crumb__sep" aria-hidden="true">
                  ›
                </span>
                <strong aria-current="true">{elLabel}</strong>
              </>
            ) : (
              <strong>{name}</strong>
            )}
          </nav>
          <code>{id}</code>
        </div>
        <div className="ed-insp__actions">
          <PanelMenu
            panel={panel}
            part={part}
            styled={styled}
            styleClip={styleClip}
            onCopyStyle={onCopyStyle}
            onPasteStyle={onPasteStyle}
            onResetElements={() => onResetElements(id)}
          />
          <button
            type="button"
            className="ed-btn"
            onClick={() => onPanel(id, { hidden: !panel.hidden })}
            title={panel.hidden ? 'Show this block again' : 'Hide this block; it stays on the layout (its eye in the list does the same)'}
          >
            {panel.hidden ? 'Show' : 'Hide'}
          </button>
          <button type="button" className="ed-btn ed-btn--danger" onClick={() => onRemove(id)} title="Take this block off the layout (Delete); ⌘Z brings it back">
            Delete
          </button>
        </div>
      </header>
      {selectedElement && (
        <ElementSection
          panel={panel}
          elKey={selectedElement}
          label={elLabel}
          knobsTitle={hasGroup ? `${title} settings for ${elLabel}` : null}
          onShowKnobs={showKnobs}
          onElementStyle={onElementStyle}
          onResetElement={onResetElement}
          onFieldHover={onFieldHover}
        />
      )}
      {selectedElement && !hasGroup && (
        <p className="ed-note ed-insp__note">
          {hiddenWhy.length
            ? `${title} settings for ${elLabel} are hidden while ${hiddenWhy.join(' and ')}.`
            : `${title} has no settings of its own for ${elLabel}; the block's are below.`}
        </p>
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

      <BoxSections panel={panel} onBoxProp={onBoxProp} onFieldHover={onFieldHover} />

      <RulesSection panel={panel} onWhen={onWhen} />

      <section className="ed-sec">
        <h3>State</h3>
        <Row label="Visible">
          <Toggle ariaLabel="Visible" checked={!panel.hidden} onChange={(on) => onPanel(id, { hidden: !on })} />
        </Row>
        <Row label="Locked" hint="No dragging or resizing">
          <Toggle ariaLabel="Locked" checked={panel.locked} onChange={(on) => onPanel(id, { locked: on })} />
        </Row>
      </section>

      {fields.length > 0 && (
        <section className="ed-sec ed-knobs" aria-label={`${title} settings`}>
          <div className="ed-sec__head">
            <h3>{ownProps ? title : `${title} settings`}</h3>
            {!ownProps && (
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
          {hasSrc && <ArtPicker src={pr.src} art={art} onRefresh={onRefreshArt} onPick={(url) => set({ src: url })} />}
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
              <FieldList
                fields={g.fields}
                pairs={pairs}
                read={read}
                textRefFor={(f) => (panel.type === 'text' && f.key === 'text' ? textRef : undefined)}
                wrap={(f, node) => (
                  <Hover id={id} element={g.element} onFieldHover={onFieldHover}>
                    {node}
                  </Hover>
                )}
                onChange={(f, v, run) => set({ [f.key]: v }, run)}
              />
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

// The header's menu: copy the panel's style, paste one onto it, clear its
// element styles.
function PanelMenu({ panel, part, styled, styleClip, onCopyStyle, onPasteStyle, onResetElements }) {
  const same = styleClip && styleClip.type === panel.type
  // Not onto the panel it came from (the same one on another day part is fine).
  const from = styleClip && !(styleClip.id === panel.id && styleClip.part === part) ? styleClip : null
  return (
    <Menu label={<MoreIcon />} buttonClass="ed-btn ed-btn--icon ed-btn--menu" align="end" title="Copy and paste style">
      {(close) => (
        <>
          <MenuItem close={close} onSelect={onCopyStyle} title="Its look and its rule: not where it is, nor what it shows">
            <span className="ed-menu__grow">Copy style</span>
            <kbd>⌥⌘C</kbd>
          </MenuItem>
          <MenuItem
            close={close}
            disabled={!from}
            onSelect={onPasteStyle}
            title={from ? `${from.label}'s look and rule${same ? ' and its settings' : ''}` : 'Copy a style first'}
          >
            <span className="ed-menu__grow">{from ? `Paste style from ${from.label}` : 'Paste style'}</span>
            <kbd>⌥⌘V</kbd>
          </MenuItem>
          <MenuItem close={close} disabled={!styled} onSelect={onResetElements}>
            Reset element styles{styled ? ` (${styled})` : ''}
          </MenuItem>
          <MenuNote>
            {same || !styleClip
              ? 'A style is the look (appearance, fill, type, element styles) and the rule; onto the same kind of block its settings too.'
              : `A style from ${styleClip.label} carries its look and rule; its settings only go onto another ${typeLabel(styleClip.type)}.`}
          </MenuNote>
        </>
      )}
    </Menu>
  )
}

// One sub-element's style, from the element style schema. Sparse: a field at
// its default is not stored; Reset element drops them all.
function ElementSection({ panel, elKey, label, knobsTitle, onShowKnobs, onElementStyle, onResetElement, onFieldHover }) {
  const known = elementList(panel.type).some((e) => e.key === elKey)
  const style = elementStyleOf(panel, elKey)
  const fields = elementStyleFields()
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const read = (key) => (byKey.has(key) ? styleValue(byKey.get(key), style) : style[key])
  const pairs = hourRangePairs(fields)
  return (
    <section className="ed-sec ed-elsec" aria-label={`${label} style`}>
      <div className="ed-sec__head">
        <h3>Element</h3>
        {known && (
          <button
            type="button"
            className="ed-link"
            disabled={!isStyled(style) && !Object.keys(style).length}
            onClick={() => onResetElement(panel.id, elKey)}
            title={`${label} back to the look as designed`}
          >
            Reset element
          </button>
        )}
      </div>
      {!known ? (
        <p className="ed-note ed-note--top">{label} cannot be styled on its own.</p>
      ) : (
        <FieldList
          fields={shownFields(fields, read, pairs)}
          pairs={pairs}
          read={read}
          wrap={(f, node) => (
            <Hover id={panel.id} element={elKey} onFieldHover={onFieldHover}>
              {node}
            </Hover>
          )}
          onChange={(f, v, run) => onElementStyle(panel.id, elKey, { [f.key]: v }, runKey(run), runWindow(run))}
        />
      )}
      {knobsTitle && (
        <button type="button" className="ed-link ed-elsec__more" onClick={onShowKnobs}>
          {knobsTitle} ↓
        </button>
      )}
    </section>
  )
}

// --- box v2 -----------------------------------------------------------------------------

// Does the box hold words of its own? Not when its element list is its title
// alone (a shape): the title takes an element style, and the Type section
// (font, text colour, vertical align) has nothing else to act on. A type
// with no element list at all keeps the section, as before.
function hasOwnText(type) {
  const els = elementList(type)
  return !els.length || els.some((e) => e.key !== 'title')
}

// Where each top-level box key is shown, in this order; a key the schema adds
// that is not listed here gets a section of its own at the end. showFor: the
// types the section is for (every type when absent).
const BOX_SECTIONS = [
  { title: 'Fill and border', tops: ['bg', 'border', 'shadow', 'blur'] },
  { title: 'Type', tops: ['font', 'color', 'valign'], showFor: hasOwnText },
  { title: 'Block title', tops: ['title'] },
]
const BOX_GROUPS = { bg: 'Fill', border: 'Border' }
// The order inside a section where the schema's differs: the second colour
// right after the gradient that brings it.
const BOX_ORDER = ['bg.color', 'bg.opacity', 'bg.gradient', 'bg.color2', 'border.width', 'border.color']
const orderOf = (key) => {
  const i = BOX_ORDER.indexOf(key)
  return i < 0 ? BOX_ORDER.length : i
}
// The editor's own hints, over the schema's.
const BOX_HINTS = { blur: 'Shows as a tint on the Echo', valign: 'Top is the block as designed' }
// The editor's own option names, over the schema's (the title's "as the
// block has it" option).
const BOX_OPTION_LABELS = { 'title.mode': { default: 'Default' } }
function withOptionLabels(key, field) {
  const names = BOX_OPTION_LABELS[key]
  if (!names || !Array.isArray(field.options)) return field
  return { ...field, options: field.options.map(([v, label, ...rest]) => [v, Object.prototype.hasOwnProperty.call(names, v) ? names[v] : label, ...rest]) }
}
// What an unset colour means, where the schema does not say.
const BOX_NULL_LABELS = { color: 'Global', 'bg.color': 'Preset', 'bg.color2': 'Fade' }
// Shown only when they mean something: the editor's rules, and the schema's
// own `showIf: { 'title.mode': 'custom' }` (a value, or a list of them; the
// same reading as a knob's, schema.js showIfHolds).
const BOX_SHOWN = {
  'bg.color2': (props) => (getPath(props, ['bg', 'gradient']) ?? 'none') !== 'none',
}
function boxShown(b, props, all) {
  if (BOX_SHOWN[b.key] && !BOX_SHOWN[b.key](props)) return false
  return showIfHolds(b.field.showIf, (key) => {
    const other = all.find((x) => x.key === key)
    const raw = getPath(props, String(key).split('.'))
    return raw === undefined || raw === null ? other?.field.default : raw
  })
}

function BoxSections({ panel, onBoxProp, onFieldHover }) {
  const list = boxFieldsFor(panel.type)
  const placed = new Set(BOX_SECTIONS.flatMap((x) => x.tops))
  const extra = [...new Set(list.map((b) => b.top).filter((t) => !placed.has(t)))]
  const sections = [...BOX_SECTIONS, ...(extra.length ? [{ title: 'More', tops: extra }] : [])]
  return sections.map((sec) => {
    if (sec.showFor && !sec.showFor(panel.type)) return null
    const fields = list
      .filter((b) => sec.tops.includes(b.top) && boxShown(b, panel.props, list))
      .map((b, i) => ({ b, i }))
      .sort((x, y) => orderOf(x.b.key) - orderOf(y.b.key) || x.i - y.i)
      .map(({ b }) => b)
    if (!fields.length) return null
    // A group's name over its first field (Fill, Border), where the section
    // holds more than that group.
    const groupOf = (b) => (b.path.length > 1 ? b.group || BOX_GROUPS[b.top] || null : null)
    return (
      <section key={sec.title} className="ed-sec ed-boxsec">
        <h3>{sec.title}</h3>
        {fields.map((b, i) => {
          const groupName = groupOf(b)
          const heading = groupName && sec.tops.length > 1 && (i === 0 || groupOf(fields[i - 1]) !== groupName) ? groupName : null
          const raw = getPath(panel.props, b.path)
          const v = cleanBoxValue(b.field, raw)
          let field = withOptionLabels(b.key, BOX_HINTS[b.key] ? { ...b.field, hint: BOX_HINTS[b.key] } : b.field)
          if (field.nullable && !field.nullLabel && BOX_NULL_LABELS[b.key]) field = { ...field, nullLabel: BOX_NULL_LABELS[b.key] }
          return (
            <div key={b.key} className="ed-boxfield">
              {heading && <h4 className="ed-subhead">{heading}</h4>}
              <Hover id={panel.id} onFieldHover={onFieldHover}>
                <SchemaField
                  field={field}
                  value={v === undefined ? b.field.default : v}
                  onChange={(val) => onBoxProp(panel.id, b.path, val, b.field, coalesceFor(b.field))}
                />
              </Hover>
            </div>
          )
        })}
      </section>
    )
  })
}

// --- show when ----------------------------------------------------------------------------

const MODE_OPTIONS = [
  ['all', 'All', 'Shows when every condition holds'],
  ['any', 'Any', 'Shows when at least one holds'],
]

// A panel's rule: "Always" (none), or conditions from the rule registry, each
// with its parameters and a Not; All or Any once there are two.
function RulesSection({ panel, onWhen }) {
  const kinds = ruleKinds()
  const when = panel.when || null
  const conds = whenConditions(when)
  const mode = whenMode(when)
  const both = !!(when?.all?.length && when?.any?.length)
  const full = conds.length >= MAX_CONDITIONS
  const id = panel.id

  function setList(m, list, coalesce) {
    const next = { ...(when || {}) }
    if (list.length) next[m] = list
    else delete next[m]
    onWhen(id, Object.keys(next).length ? next : null, coalesce)
  }
  const add = (kind) => setList(mode, [...(when?.[mode] || []), { kind }])
  const update = (m, i, patch, coalesce) =>
    setList(
      m,
      when[m].map((c, j) => {
        if (j !== i) return c
        const n = { ...c, ...patch }
        if (!n.not) delete n.not
        return n
      }),
      coalesce
    )
  const remove = (m, i) => setList(m, when[m].filter((_, j) => j !== i))
  const switchMode = (m) => {
    if (both || m === mode || !when) return
    onWhen(id, { [m]: when[mode] })
  }

  return (
    <section className="ed-sec ed-rules" aria-label="Show when">
      <div className="ed-sec__head">
        <h3>Show when</h3>
        {conds.length > 0 && (
          <button type="button" className="ed-link" onClick={() => onWhen(id, null)} title="Drop the rule: always shown">
            Always
          </button>
        )}
      </div>
      {!conds.length ? (
        <p className="ed-rules__always">
          <strong>Always</strong> <span>shown whenever this layout is.</span>
        </p>
      ) : (
        <>
          {conds.length >= 2 && !both && (
            <Row label="Shows if">
              <Segmented ariaLabel="All or any" options={MODE_OPTIONS} value={mode} onChange={switchMode} />
            </Row>
          )}
          <ul className="ed-conds">
            {conds.map(({ mode: m, index: i, cond }, n) => (
              <CondRow
                key={`${m}-${i}`}
                cond={cond}
                joiner={n === 0 ? null : m === 'any' ? (both && conds[n - 1].mode === 'all' ? 'and any of' : 'or') : 'and'}
                onChange={(patch, coalesce) => update(m, i, patch, coalesce && `when:${id}:${m}:${i}:${coalesce}`)}
                onRemove={() => remove(m, i)}
              />
            ))}
          </ul>
        </>
      )}
      <Menu
        className="ed-rules__add"
        disabled={full || !kinds.length}
        title={full ? `At most ${MAX_CONDITIONS} conditions` : 'Show this block only when…'}
        label={conds.length ? 'Add condition' : 'Add a condition'}
      >
        {(close) =>
          kinds.map((k) => (
            <MenuItem key={k.kind} close={close} onSelect={() => add(k.kind)} title={k.hint}>
              {k.label}
            </MenuItem>
          ))
        }
      </Menu>
    </section>
  )
}

function CondRow({ cond, joiner, onChange, onRemove }) {
  const kind = ruleKind(cond.kind)
  const label = kind?.label || cond.kind
  return (
    <li className={`ed-cond${cond.not ? ' is-not' : ''}`}>
      {joiner && <span className="ed-cond__joiner">{joiner}</span>}
      <div className="ed-cond__head">
        <span className="ed-cond__kind">
          {cond.not ? <em>not </em> : null}
          {label}
        </span>
        <Toggle label="Not" checked={!!cond.not} onChange={(on) => onChange({ not: on })} title="Show when this does NOT hold" />
        <button type="button" className="ed-icon ed-cond__remove" aria-label={`Remove ${label}`} title="Remove this condition" onClick={onRemove}>
          ×
        </button>
      </div>
      {(kind?.params || []).map((param) => (
        <ParamField key={param.key} param={param} value={cond[param.key]} onChange={(v, run) => onChange({ [param.key]: v }, run ? param.key : null)} />
      ))}
    </li>
  )
}

function ParamField({ param, value, onChange }) {
  const label = param.label || param.key
  switch (param.type) {
    case 'time':
      return (
        <Row label={label}>
          <TimeField ariaLabel={label} value={value} onChange={(v) => onChange(v, true)} />
        </Row>
      )
    case 'number':
      return (
        <Row label={label}>
          <NumberField
            ariaLabel={label}
            value={Number.isFinite(value) ? value : param.default}
            min={Number.isFinite(param.min) ? param.min : 0}
            max={Number.isFinite(param.max) ? param.max : 365}
            step={Number.isFinite(param.step) ? param.step : 1}
            suffix={param.unit}
            onCommit={(v) => onChange(v, true)}
          />
        </Row>
      )
    case 'select':
      return <SchemaField field={{ ...param, key: param.key, label }} value={value ?? param.default} onChange={(v) => onChange(v)} />
    case 'toggle':
      return (
        <Row label={label}>
          <Toggle ariaLabel={label} checked={!!value} onChange={(on) => onChange(on)} />
        </Row>
      )
    default:
      return (
        <Row label={label}>
          <TextField ariaLabel={label} value={typeof value === 'string' ? value : ''} onCommit={(v) => onChange(v)} />
        </Row>
      )
  }
}

// --- a type the app does not know ------------------------------------------------------

// Read-only: what it is and where it sits (as stored), and Delete. It stays in
// the layout exactly as saved until deleted; an app build that knows the type
// draws it and edits it again.
function UnsupportedInspector({ panel, canvas, labels, onRemove }) {
  const name = typeLabel(panel.type, labels)
  const box = [panel.x, panel.y, panel.w, panel.h].every(Number.isFinite) ? pctToPxRound(panel, canvas) : null
  return (
    <div className="ed-insp ed-insp__unsupported">
      <header className="ed-insp__head">
        <div className="ed-insp__title">
          <strong>{name}</strong>
          <code>{panel.id}</code>
        </div>
        <div className="ed-insp__actions">
          <button
            type="button"
            className="ed-btn ed-btn--danger"
            onClick={() => onRemove(panel.id)}
            title="Take it off the layout (Delete); ⌘Z brings it back"
          >
            Delete
          </button>
        </div>
      </header>
      <section className="ed-sec">
        <p className="ed-prompt">
          Not supported by this app: the app in the preview has no <code>{panel.type}</code>, so it draws nothing here and
          the editor cannot change it. It stays in the layout exactly as saved, and a build that knows it shows it again.
        </p>
        {box && (
          <p className="ed-note">
            Saved at {box.x}, {box.y}, {box.w} x {box.h} px on {canvas.w} x {canvas.h}
            {panel.hidden === true ? ', hidden' : ''}.
          </p>
        )}
      </section>
    </div>
  )
}

// --- several panels -----------------------------------------------------------------------

function GroupInspector({ group, labels, names, styleClip, onPasteStyle, onSelect, onRemoveGroup }) {
  return (
    <div className="ed-insp">
      <header className="ed-insp__head">
        <div className="ed-insp__title">
          <strong>{group.length} blocks</strong>
          <code>{group.map((p) => p.id).join(', ')}</code>
        </div>
        <div className="ed-insp__actions">
          <button type="button" className="ed-btn ed-btn--danger" onClick={onRemoveGroup} title="Take these blocks off the layout (Delete); ⌘Z brings them back">
            Delete
          </button>
        </div>
      </header>
      <section className="ed-sec">
        <h3>Selected</h3>
        <ul className="ed-grouplist">
          {group.map((p, i) => (
            <li key={p.id}>
              <button type="button" className="ed-link" onClick={() => onSelect(p.id)} title="Select just this one">
                {panelLabel(p, labels, names)}
              </button>
              {i === 0 && <span className="ed-grouplist__first">first: Match width and height use its size</span>}
              {p.locked && <span className="ed-grouplist__first">locked: stays put</span>}
            </li>
          ))}
        </ul>
        <p className="ed-note">
          Drag any of them to move them together. The arrange tools are in the top bar. Shift-click a block to add it or take it out.
        </p>
      </section>
      <section className="ed-sec">
        <h3>Style</h3>
        <button type="button" className="ed-btn" disabled={!styleClip} onClick={onPasteStyle}>
          {styleClip ? `Paste ${styleClip.label}'s style onto all` : 'Paste style onto all'}
        </button>
        <p className="ed-note">{styleClip ? 'One undo step.' : 'Copy a style first: select one block, its menu, Copy style (⌥⌘C).'}</p>
      </section>
      <Keys />
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
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const read = (key) => (byKey.has(key) ? g[key] ?? defaultGlobal?.[key] ?? byKey.get(key).default : g[key])
  const pairs = hourRangePairs(fields)
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
      <FieldList
        fields={shownFields(fields, read, pairs)}
        pairs={pairs}
        read={read}
        onChange={(f, v, run) => onGlobal({ [f.key]: v }, runKey(run), runWindow(run))}
      />
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
        <dt>Shift-click</dt>
        <dd>add to the selection, or take out</dd>
        <dt>Drag</dt>
        <dd>move; Shift keeps one axis</dd>
        <dt>Handles</dt>
        <dd>resize; Shift keeps the aspect</dd>
        <dt>Option</dt>
        <dd>ignore the grid and the guides while dragging</dd>
        <dt>Arrows</dt>
        <dd>nudge 1 px, Shift 10 px</dd>
        <dt>Delete</dt>
        <dd>remove the block (⌘Z brings it back); with a part of it selected, hide that part</dd>
        <dt>Esc</dt>
        <dd>up a level: part, block, nothing; or cancel a drag</dd>
        <dt>⌘Z  ⇧⌘Z</dt>
        <dd>undo, redo</dd>
        <dt>⌥⌘C  ⌥⌘V</dt>
        <dd>copy style, paste style</dd>
        <dt>⌘S</dt>
        <dd>save</dd>
      </dl>
    </section>
  )
}
