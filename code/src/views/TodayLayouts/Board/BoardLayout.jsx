import useTodayData from '../data/useTodayData.js'
import SpecBoard from '../Entry/SpecBoard.jsx'
import { BOARD_LAYOUT_ID } from '../layoutSpec.js'
import './BoardLayout.css'

// BoardLayout - the dark bento board: the clock anchoring the top left, the
// photo the single largest element, every panel a tile.
//
// Drawn from a layout spec by the same machinery as the Entry board
// (Entry/SpecBoard.jsx, layoutSpec.js): the screen's own config.layouts.board
// from the layout editor, or DEFAULT_BOARD_SPEC, which is the 12 x 6 grid this
// layout always was, measured into percent boxes:
//
//   clock    cols 1-4  rows 1-3      photo       cols 9-12 rows 1-4
//   weather  cols 5-8  rows 1-3      now playing cols 9-12 rows 5-6
//   forecast cols 1-4  rows 4-6        (the departure countdown instead while
//   sun and moon cols 5-8 rows 4-5      one runs)
//   what to wear cols 5-8 row 6
//
// No backdrop: the page is the Board's dark gradient and the photo is a tile.
// This component is the only thing here that touches data: useTodayData()
// runs once and every panel is a pure display of the slice it is handed.

export default function BoardLayout() {
  const d = useTodayData()
  return <SpecBoard d={d} layoutId={BOARD_LAYOUT_ID} className="tl-root tl-board" />
}
