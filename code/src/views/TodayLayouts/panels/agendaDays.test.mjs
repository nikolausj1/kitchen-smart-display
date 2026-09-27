// Tests for panels/agendaDays.js (the agenda's columns and its row budget) and
// the agenda's row layout knobs as the layout spec reads them (2026-09-27).
// Run from the project root: node --test 'code/src/**/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AGENDA_ROW_EM, agendaDayCount, agendaRowFit, sliceAgendaDays } from './agendaDays.js'
import { knobDefaults } from './schemas.js'
import { DEFAULT_ENTRY_SPEC, knobsOf, normalizeSpec } from '../layoutSpec.js'

// The budget as AgendaPanel.jsx wrote it before the row layouts.
const oldFit = (rows, extra = 0) => Math.round((((6 * 3.06 + 1.2) / (rows * (3.06 + extra * 1.1) + 1.2)) * 10000)) / 10000

test('the row budget at the defaults is the old one, number for number', () => {
  assert.equal(AGENDA_ROW_EM, 3.06)
  for (let rows = 2; rows <= 10; rows++) {
    for (const extra of [0, 1, 2]) {
      assert.equal(agendaRowFit({ rows, extraLines: extra }), oldFit(rows, extra), `${rows} rows, ${extra} extra`)
      assert.equal(agendaRowFit({ rows, extraLines: extra, titleLines: 2, rowGap: 1, stacked: false }), oldFit(rows, extra))
    }
  }
  assert.equal(agendaRowFit({ rows: 6 }), 1)
  assert.equal(agendaRowFit(), 1)
})

test('the row budget counts the title lines, the gap and a stacked time line', () => {
  // One-line titles make room: the cap may grow.
  assert.ok(agendaRowFit({ rows: 6, titleLines: 1 }) > 1)
  // A time line over each title, or a wider gap, costs room: the cap shrinks.
  assert.ok(agendaRowFit({ rows: 6, stacked: true }) < 1)
  assert.ok(agendaRowFit({ rows: 6, rowGap: 2 }) < 1)
  assert.ok(agendaRowFit({ rows: 6, rowGap: 0 }) > 1)
  // Six stacked rows: 6 x (3.06 + 1) + 1.2 against 6 x 3.06 + 1.2.
  assert.equal(agendaRowFit({ rows: 6, stacked: true }), Math.round(((6 * 3.06 + 1.2) / (6 * (3.06 + 1) + 1.2)) * 10000) / 10000)
  // Out of range: clamped, or the default.
  assert.equal(agendaRowFit({ rows: 6, rowGap: 9 }), agendaRowFit({ rows: 6, rowGap: 2 }))
  assert.equal(agendaRowFit({ rows: 6, titleLines: 3 }), 1)
})

test('the columns: the knobs cut the days from today', () => {
  const days = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => ({ dateKey: k }))
  assert.deepEqual(sliceAgendaDays(days, { days: 2, startDay: 'tomorrow' }).map((d) => d.dateKey), ['b', 'c'])
  assert.equal(agendaDayCount({ days: 9 }), 5)
})

test('the row layout knobs: defaults as the agenda was, junk back to them', () => {
  const d = knobDefaults('agenda')
  assert.deepEqual([d.rowLayout, d.titleLines, d.dayHeader, d.rowGap], ['side', 2, 'caps', 1])
  const entry = DEFAULT_ENTRY_SPEC.panels.find((p) => p.id === 'agenda')
  assert.deepEqual([entry.props.rowLayout, entry.props.titleLines, entry.props.dayHeader, entry.props.rowGap], ['side', 2, 'caps', 1])
  const spec = normalizeSpec({
    panels: [
      { id: 'agenda', type: 'agenda', props: { rowLayout: 'stacked', titleLines: '1', dayHeader: 'bold', rowGap: 0.44 } },
      { id: 'agenda-0001', type: 'agenda', props: { rowLayout: 'diagonal', titleLines: 3, dayHeader: 'loud', rowGap: 7 } },
    ],
  })
  const [a, b] = spec.panels.map(knobsOf)
  assert.deepEqual([a.rowLayout, a.titleLines, a.dayHeader, a.rowGap], ['stacked', 1, 'bold', 0.4])
  assert.deepEqual([b.rowLayout, b.titleLines, b.dayHeader, b.rowGap], ['side', 2, 'caps', 2])
})
