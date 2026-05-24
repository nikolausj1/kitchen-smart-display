import { useEffect, useState } from 'react'
import { useSettings, updateSettings, resetSettings } from '../../lib/settings.js'
import './SettingsView.css'

// SettingsView - the four main config groups, all auto-saved to localStorage
// via updateSettings(). Stays full-screen until the user navigates away via
// the menu pill.

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

function TimeOfDay({ hour, minute, onChange }) {
  return (
    <div className="settings-time">
      <NumberField
        value={hour}
        onChange={(v) => onChange({ hour: Math.max(0, Math.min(23, v || 0)), minute })}
        min={0}
        max={23}
      />
      <span className="settings-time__sep">:</span>
      <NumberField
        value={String(minute).padStart(2, '0')}
        onChange={(v) => onChange({ hour, minute: Math.max(0, Math.min(59, v || 0)) })}
        min={0}
        max={59}
      />
    </div>
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
  const { location, school, sonos, slideshow } = settings

  function toggleDay(d) {
    const set = new Set(school.schoolDays)
    set.has(d) ? set.delete(d) : set.add(d)
    updateSettings({ school: { schoolDays: [...set].sort() } })
  }

  function onResetAll() {
    if (confirm('Reset ALL settings to defaults?')) resetSettings()
  }

  return (
    <div className="settings">
      <div className="settings__scroll">
        <h1 className="settings__title">Settings</h1>

        {/* --- Location --- */}
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
          <Row label="Seconds per photo">
            <NumberField
              value={Math.round(slideshow.intervalMs / 1000)}
              min={1}
              max={120}
              suffix="s"
              onChange={(v) =>
                updateSettings({
                  slideshow: { intervalMs: Math.max(1000, (Number(v) || 6) * 1000) },
                })
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
