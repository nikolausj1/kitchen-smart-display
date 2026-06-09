import { useEffect, useRef, useState } from 'react'
import { useSettings, updateSettings, resetSettings } from '../../lib/settings.js'
import { useView } from '../../shell/ViewContext.jsx'
import useImmichPhotos from '../../hooks/useImmichPhotos.js'
import './SettingsView.css'

// If the Settings screen sees no user activity for this long, auto-bounce
// back to the Photos view so the device returns to its ambient state.
const IDLE_TO_PHOTOS_MS = 60_000

// SettingsView - the four main config groups, all auto-saved to localStorage
// via updateSettings(). Stays full-screen until the user navigates away via
// the menu pill.

const DAY_LABELS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]

function Row({ label, children, hint }) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        {label}
        {hint && <div className="settings-row__hint">{hint}</div>}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  )
}

function NumberField({ value, onChange, step = 1, min, max, suffix }) {
  return (
    <div className="settings-number">
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = e.target.value === '' ? '' : Number(e.target.value)
          onChange(v)
        }}
        data-interactive="true"
      />
      {suffix && <span className="settings-number__suffix">{suffix}</span>}
    </div>
  )
}

// Touch-friendly +/- stepper. Numeric value with big tap targets.
function Stepper({ value, onChange, min = 1, max = 999, step = 1, suffix }) {
  function clamp(n) {
    return Math.max(min, Math.min(max, n))
  }
  return (
    <div className="settings-stepper">
      <button
        type="button"
        className="settings-stepper__btn"
        onClick={(e) => {
          e.stopPropagation()
          onChange(clamp((Number(value) || 0) - step))
        }}
        aria-label="Decrease"
        data-interactive="true"
      >
        &minus;
      </button>
      <div className="settings-stepper__value">
        {value}
        {suffix && <span className="settings-stepper__suffix">{suffix}</span>}
      </div>
      <button
        type="button"
        className="settings-stepper__btn"
        onClick={(e) => {
          e.stopPropagation()
          onChange(clamp((Number(value) || 0) + step))
        }}
        aria-label="Increase"
        data-interactive="true"
      >
        +
      </button>
    </div>
  )
}

// Touch-friendly slider with live readout.
function Slider({ value, onChange, min = 1, max = 60, step = 1, suffix }) {
  return (
    <div className="settings-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        data-interactive="true"
      />
      <div className="settings-slider__readout">
        {value}
        {suffix && <span className="settings-slider__suffix">{suffix}</span>}
      </div>
    </div>
  )
}

function TimeOfDay({ hour, minute, onChange }) {
  return (
    <div className="settings-time">
      <Stepper
        value={hour}
        onChange={(v) => onChange({ hour: Math.max(0, Math.min(23, v || 0)), minute })}
        min={0}
        max={23}
      />
      <span className="settings-time__sep">:</span>
      <Stepper
        value={String(minute).padStart(2, '0')}
        onChange={(v) =>
          onChange({ hour, minute: Math.max(0, Math.min(59, Number(v) || 0)) })
        }
        min={0}
        max={59}
      />
    </div>
  )
}

// Short id for kids/activities. crypto.randomUUID is available in secure
// contexts (https and localhost - both apply here); fall back just in case.
function uid() {
  try {
    return crypto.randomUUID()
  } catch {
    return `id-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  }
}

const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// Compact weekday multi-select (0=Sun..6=Sat). Mirrors the School days row.
function WeekdayPicker({ value, onChange }) {
  const set = new Set(value || [])
  return (
    <div className="settings-days settings-days--compact">
      {DAY_ABBR.map((label, i) => {
        const on = set.has(i)
        return (
          <button
            key={i}
            type="button"
            className={'settings-day' + (on ? ' settings-day--on' : '')}
            onClick={(e) => {
              e.stopPropagation()
              const next = new Set(set)
              next.has(i) ? next.delete(i) : next.add(i)
              onChange([...next].sort())
            }}
            data-interactive="true"
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function TextField({ value, onChange, placeholder }) {
  return (
    <input
      type="text"
      className="settings-text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      data-interactive="true"
    />
  )
}

function OnOffSelect({ on, onChange }) {
  return (
    <select
      className="settings-select"
      value={on ? 'on' : 'off'}
      onChange={(e) => onChange(e.target.value === 'on')}
      data-interactive="true"
    >
      <option value="on">On</option>
      <option value="off">Off</option>
    </select>
  )
}

// --- Sonos room dropdown -----------------------------------------------------

function SonosRoomSelect({ apiBase, value, onChange }) {
  const [rooms, setRooms] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${apiBase}/zones`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const names = new Set()
        for (const g of data) {
          for (const m of g.members || []) names.add(m.roomName)
        }
        setRooms([...names].sort())
      })
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [apiBase])

  if (error) {
    return (
      <div className="settings-error">
        Couldn&rsquo;t reach Sonos API ({error}). Using saved value: {value}
      </div>
    )
  }
  if (!rooms) {
    return <div className="settings-note">Loading rooms&hellip;</div>
  }

  return (
    <select
      className="settings-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-interactive="true"
    >
      {!rooms.includes(value) && <option value={value}>{value} (offline?)</option>}
      {rooms.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  )
}

// --- View --------------------------------------------------------------------

export default function SettingsView() {
  const settings = useSettings()
  const { location, school, sonos, slideshow, display } = settings
  const { setView } = useView()
  const { albums: manifestAlbums } = useImmichPhotos()

  // Album picker. selectedAlbumIds=null means "all albums" - we show every
  // album toggled on. Toggling one switches us to an explicit array.
  const selectedSet = (() => {
    if (!Array.isArray(slideshow?.selectedAlbumIds)) {
      return new Set((manifestAlbums || []).map((a) => a.id))
    }
    return new Set(slideshow.selectedAlbumIds)
  })()
  function toggleAlbum(id) {
    const next = new Set(selectedSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    updateSettings({ slideshow: { selectedAlbumIds: [...next] } })
  }

  // Idle-bounce to Photos: any touch, scroll, or input within Settings
  // resets a 60s timer. When it fires, navigate to Photos. Listeners are
  // attached to the scroll root and use the capture phase so they fire
  // even when a child stops propagation.
  const rootRef = useRef(null)
  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    let timerId = setTimeout(() => setView('photos'), IDLE_TO_PHOTOS_MS)
    function bump() {
      clearTimeout(timerId)
      timerId = setTimeout(() => setView('photos'), IDLE_TO_PHOTOS_MS)
    }
    const events = ['pointerdown', 'touchmove', 'wheel', 'input', 'change', 'keydown']
    events.forEach((e) => node.addEventListener(e, bump, { capture: true, passive: true }))
    return () => {
      clearTimeout(timerId)
      events.forEach((e) => node.removeEventListener(e, bump, { capture: true }))
    }
  }, [setView])

  function toggleDay(d) {
    const set = new Set(school.schoolDays)
    set.has(d) ? set.delete(d) : set.add(d)
    updateSettings({ school: { schoolDays: [...set].sort() } })
  }

  // --- School schedule: kids/activities + no-school overrides ---
  const kids = school.kids || []
  const overrides = school.noSchoolOverrides || []
  const [overrideDate, setOverrideDate] = useState('')

  const updateKids = (next) => updateSettings({ school: { kids: next } })
  const addKid = () => updateKids([...kids, { id: uid(), name: '', activities: [] }])
  const removeKid = (id) => updateKids(kids.filter((k) => k.id !== id))
  const setKidName = (id, name) =>
    updateKids(kids.map((k) => (k.id === id ? { ...k, name } : k)))
  const mapActs = (kidId, fn) =>
    updateKids(kids.map((k) => (k.id === kidId ? { ...k, activities: fn(k.activities || []) } : k)))
  const addActivity = (kidId) =>
    mapActs(kidId, (acts) => [...acts, { id: uid(), label: '', weekdays: [] }])
  const removeActivity = (kidId, actId) =>
    mapActs(kidId, (acts) => acts.filter((a) => a.id !== actId))
  const setActivity = (kidId, actId, patch) =>
    mapActs(kidId, (acts) => acts.map((a) => (a.id === actId ? { ...a, ...patch } : a)))

  function addOverride() {
    const d = overrideDate
    if (!d || overrides.includes(d)) {
      setOverrideDate('')
      return
    }
    updateSettings({ school: { noSchoolOverrides: [...overrides, d].sort() } })
    setOverrideDate('')
  }
  const removeOverride = (d) =>
    updateSettings({ school: { noSchoolOverrides: overrides.filter((x) => x !== d) } })

  function onResetAll() {
    if (confirm('Reset ALL settings to defaults?')) resetSettings()
  }

  return (
    <div className="settings" ref={rootRef}>
      <div className="settings__scroll">
        <h1 className="settings__title">Settings</h1>

        {/* --- School / morning timer --- */}
        <section className="settings-section">
          <h2 className="settings-section__title">School &amp; morning timer</h2>
          <Row label="Driving depart" hint="Time to leave when driving.">
            <TimeOfDay
              hour={school.drivingDepart.hour}
              minute={school.drivingDepart.minute}
              onChange={(t) => updateSettings({ school: { drivingDepart: t } })}
            />
          </Row>
          <Row label="Walking depart" hint="Time to leave when walking.">
            <TimeOfDay
              hour={school.walkingDepart.hour}
              minute={school.walkingDepart.minute}
              onChange={(t) => updateSettings({ school: { walkingDepart: t } })}
            />
          </Row>
          <Row label="Auto-show at" hint="Today screen appears at this time on school days.">
            <TimeOfDay
              hour={school.autoShowAt.hour}
              minute={school.autoShowAt.minute}
              onChange={(t) => updateSettings({ school: { autoShowAt: t } })}
            />
          </Row>
          <Row label="Morning ends at" hint="Today screen auto-switches back to Photos at this time on school days.">
            <TimeOfDay
              hour={school.morningEndsAt?.hour ?? 8}
              minute={school.morningEndsAt?.minute ?? 0}
              onChange={(t) => updateSettings({ school: { morningEndsAt: t } })}
            />
          </Row>
          <Row label="School days">
            <div className="settings-days">
              {DAY_LABELS.map((label, i) => {
                const on = school.schoolDays.includes(i)
                return (
                  <button
                    key={i}
                    type="button"
                    className={'settings-day' + (on ? ' settings-day--on' : '')}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleDay(i)
                    }}
                    data-interactive="true"
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </Row>
        </section>

        {/* --- School schedule (lunch, activities, no-school overrides) --- */}
        <section className="settings-section">
          <h2 className="settings-section__title">School schedule</h2>
          <Row label="Lunch menu" hint="Show today's lunch entree on the Today screen.">
            <OnOffSelect
              on={school.lunch?.enabled !== false}
              onChange={(v) => updateSettings({ school: { lunch: { enabled: v } } })}
            />
          </Row>
          <Row label="School (MealViewer)" hint="School name in the MealViewer URL: schools.mealviewer.com/school/<name>.">
            <TextField
              value={school.lunch?.schoolSlug ?? 'Lawton'}
              placeholder="Lawton"
              onChange={(v) => updateSettings({ school: { lunch: { schoolSlug: v } } })}
            />
          </Row>

          <Row label="Kids &amp; activities" hint="Recurring reminders shown on the Today screen (e.g. Library day).">
            <div className="settings-kids">
              {kids.length === 0 && <div className="settings-note">No kids added yet.</div>}
              {kids.map((kid) => (
                <div className="settings-kid" key={kid.id}>
                  <div className="settings-kid__head">
                    <TextField
                      value={kid.name}
                      placeholder="Name"
                      onChange={(v) => setKidName(kid.id, v)}
                    />
                    <button
                      type="button"
                      className="settings-mini settings-mini--danger"
                      data-interactive="true"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeKid(kid.id)
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  {(kid.activities || []).map((act) => (
                    <div className="settings-activity" key={act.id}>
                      <TextField
                        value={act.label}
                        placeholder="Activity (e.g. Library)"
                        onChange={(v) => setActivity(kid.id, act.id, { label: v })}
                      />
                      <WeekdayPicker
                        value={act.weekdays}
                        onChange={(wd) => setActivity(kid.id, act.id, { weekdays: wd })}
                      />
                      <button
                        type="button"
                        className="settings-mini settings-mini--danger"
                        data-interactive="true"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeActivity(kid.id, act.id)
                        }}
                        aria-label="Remove activity"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="settings-mini"
                    data-interactive="true"
                    onClick={(e) => {
                      e.stopPropagation()
                      addActivity(kid.id)
                    }}
                  >
                    + Add activity
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="settings-mini"
                data-interactive="true"
                onClick={(e) => {
                  e.stopPropagation()
                  addKid()
                }}
              >
                + Add kid
              </button>
            </div>
          </Row>

          <Row label="No-school dates" hint="Extra closures on top of the district calendar (snow days, etc.).">
            <div className="settings-overrides">
              <div className="settings-overrides__add">
                <input
                  type="date"
                  className="settings-text"
                  value={overrideDate}
                  onChange={(e) => setOverrideDate(e.target.value)}
                  data-interactive="true"
                />
                <button
                  type="button"
                  className="settings-mini"
                  data-interactive="true"
                  onClick={(e) => {
                    e.stopPropagation()
                    addOverride()
                  }}
                >
                  Add
                </button>
              </div>
              <div className="settings-chips">
                {overrides.length === 0 && <span className="settings-note">None.</span>}
                {overrides.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className="settings-chip"
                    data-interactive="true"
                    title="Remove"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeOverride(d)
                    }}
                  >
                    {d} &times;
                  </button>
                ))}
              </div>
            </div>
          </Row>
        </section>

        {/* --- Music --- */}
        <section className="settings-section">
          <h2 className="settings-section__title">Music (Sonos)</h2>
          <Row label="Room" hint="Which Sonos room the Now Playing view follows.">
            <SonosRoomSelect
              apiBase={sonos.apiBase}
              value={sonos.room}
              onChange={(v) => updateSettings({ sonos: { room: v } })}
            />
          </Row>
        </section>

        {/* --- Photos --- */}
        <section className="settings-section">
          <h2 className="settings-section__title">Photo slideshow</h2>
          <Row label="Seconds per photo" hint="How long each photo is displayed before crossfading to the next.">
            <Slider
              value={Math.round(slideshow.intervalMs / 1000)}
              min={2}
              max={60}
              step={1}
              suffix="s"
              onChange={(secs) =>
                updateSettings({
                  slideshow: { intervalMs: Math.max(2000, secs * 1000) },
                })
              }
            />
          </Row>
          <Row label="Sort order" hint="How photos are ordered through the slideshow.">
            <select
              className="settings-select"
              value={slideshow.sortOrder || 'random'}
              onChange={(e) =>
                updateSettings({ slideshow: { sortOrder: e.target.value } })
              }
              data-interactive="true"
            >
              <option value="random">Random</option>
              <option value="date-taken">Date taken (oldest first)</option>
              <option value="date-added">Date added (oldest first)</option>
            </select>
          </Row>
          <Row label="Smart faces" hint="Shift the crop to keep faces in view.">
            <select
              className="settings-select"
              value={slideshow.smartFaces === false ? 'off' : 'on'}
              onChange={(e) =>
                updateSettings({
                  slideshow: { smartFaces: e.target.value === 'on' },
                })
              }
              data-interactive="true"
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </Row>
          <Row label="Display" hint="How each photo is sized to the screen.">
            <select
              className="settings-select"
              value={slideshow.displayMode || 'smart'}
              onChange={(e) =>
                updateSettings({ slideshow: { displayMode: e.target.value } })
              }
              data-interactive="true"
            >
              <option value="smart">Smart (fill when it fits, otherwise fit)</option>
              <option value="fill">Fill (crops to fill the screen)</option>
              <option value="fit">Fit (whole photo with a blurred backdrop)</option>
            </select>
          </Row>
          <Row label="Auto-dismiss EXIF" hint="On: location/date caption fades after a delay. Off: stays visible the whole photo.">
            <select
              className="settings-select"
              value={slideshow.autoDismissExif === false ? 'off' : 'on'}
              onChange={(e) =>
                updateSettings({
                  slideshow: { autoDismissExif: e.target.value === 'on' },
                })
              }
              data-interactive="true"
            >
              <option value="on">On (auto-dismiss)</option>
              <option value="off">Off (always visible)</option>
            </select>
          </Row>
          {slideshow.autoDismissExif !== false && (
            <Row label="EXIF visible for" hint="How long the caption stays before fading out.">
              <Slider
                value={Math.max(1, slideshow.exifVisibleSeconds ?? 5)}
                min={1}
                max={30}
                step={1}
                suffix="s"
                onChange={(secs) =>
                  updateSettings({
                    slideshow: { exifVisibleSeconds: Math.max(1, secs) },
                  })
                }
              />
            </Row>
          )}
          {manifestAlbums && manifestAlbums.length > 0 && (
            <Row label="Albums" hint="Which albums feed the slideshow. All on by default.">
              <div className="settings-albums">
                {manifestAlbums.map((a) => {
                  const on = selectedSet.has(a.id)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={'settings-album' + (on ? ' settings-album--on' : '')}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleAlbum(a.id)
                      }}
                      data-interactive="true"
                    >
                      <span className="settings-album__name">{a.name}</span>
                      <span className="settings-album__count">({a.count})</span>
                    </button>
                  )
                })}
              </div>
            </Row>
          )}
        </section>

        {/* --- Display (night mode schedule) --- */}
        <section className="settings-section">
          <h2 className="settings-section__title">Display</h2>
          <Row label="Sleep now" hint="Turn the screen off right now. Touch the screen to wake.">
            <button
              type="button"
              className="settings-reset"
              onClick={(e) => {
                e.stopPropagation()
                window.dispatchEvent(new CustomEvent('display-sleep-now'))
              }}
              data-interactive="true"
            >
              Sleep now
            </button>
          </Row>
          <Row label="Brightness" hint="How bright the screen looks during the day.">
            <Slider
              value={Math.round((display?.wakeBrightness ?? 0.9) * 100)}
              min={10}
              max={100}
              step={5}
              suffix="%"
              onChange={(pct) =>
                updateSettings({
                  display: { wakeBrightness: Math.max(0.1, Math.min(1, pct / 100)) },
                })
              }
            />
          </Row>
          <Row label="Evening brightness" hint="Brightness during the night.">
            <Slider
              value={Math.round((display?.eveningBrightness ?? 0.4) * 100)}
              min={10}
              max={100}
              step={5}
              suffix="%"
              onChange={(pct) =>
                updateSettings({
                  display: { eveningBrightness: Math.max(0.1, Math.min(1, pct / 100)) },
                })
              }
            />
          </Row>
          <Row label="Dim from" hint="Screen dims at this time each evening.">
            <TimeOfDay
              hour={display?.dimAt?.hour ?? 21}
              minute={display?.dimAt?.minute ?? 0}
              onChange={(t) => updateSettings({ display: { dimAt: t } })}
            />
          </Row>
          <Row label="Off from" hint="Screen turns fully off at this time. Touch to wake.">
            <TimeOfDay
              hour={display?.offAt?.hour ?? 0}
              minute={display?.offAt?.minute ?? 0}
              onChange={(t) => updateSettings({ display: { offAt: t } })}
            />
          </Row>
          <Row label="Wake at" hint="Screen returns to full brightness in the morning.">
            <TimeOfDay
              hour={display?.wakeAt?.hour ?? 6}
              minute={display?.wakeAt?.minute ?? 0}
              onChange={(t) => updateSettings({ display: { wakeAt: t } })}
            />
          </Row>
        </section>

        {/* --- Location (bottom: rarely changed) --- */}
        <section className="settings-section">
          <h2 className="settings-section__title">Location</h2>
          <Row label="Latitude" hint="Decimal degrees. Used for weather.">
            <NumberField
              value={location.lat}
              step={0.0001}
              onChange={(v) =>
                updateSettings({ location: { lat: Number(v) || 0 } })
              }
            />
          </Row>
          <Row label="Longitude">
            <NumberField
              value={location.lon}
              step={0.0001}
              onChange={(v) =>
                updateSettings({ location: { lon: Number(v) || 0 } })
              }
            />
          </Row>
        </section>

        {/* --- Reset --- */}
        <section className="settings-section">
          <button
            type="button"
            className="settings-reset"
            onClick={(e) => {
              e.stopPropagation()
              onResetAll()
            }}
            data-interactive="true"
          >
            Reset all settings to defaults
          </button>
        </section>

        <div className="settings__footer">
          Tap a dead area to open the menu and navigate away.
        </div>
      </div>
    </div>
  )
}
