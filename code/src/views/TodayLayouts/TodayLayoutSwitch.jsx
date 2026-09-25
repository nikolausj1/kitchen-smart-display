import TodayView from '../TodayView/TodayView.jsx'
import AmbientLayout from './Ambient/AmbientLayout.jsx'
import BoardLayout from './Board/BoardLayout.jsx'
import BriefingLayout from './Briefing/BriefingLayout.jsx'
import ClockLayout from './Clock/ClockLayout.jsx'
import EntryLayout from './Entry/EntryLayout.jsx'
import { useSettings } from '../../lib/settings.js'
import { REQUESTED_LAYOUT } from '../../lib/kioskMode.js'
import { normalizeLayoutId } from './registry.js'

// TodayLayoutSwitch - picks which Today to render. 'framed' is the original
// TodayView, untouched. Anything else is one of the new layouts in this
// folder. A ?layout= URL param wins for the page load without being saved.
//
// entry and board are drawn from the screen's layout spec (layoutSpec.js,
// Entry/SpecBoard.jsx); inside the layout editor's frame (?edit=1) the one on
// screen is the one the editor edits (editBridge.js reports its id).
//
// clock is the flip clock (Clock/ClockLayout.jsx).

const LAYOUTS = {
  board: BoardLayout,
  briefing: BriefingLayout,
  ambient: AmbientLayout,
  entry: EntryLayout,
  clock: ClockLayout,
}

export default function TodayLayoutSwitch() {
  const { display } = useSettings()
  const id = normalizeLayoutId(REQUESTED_LAYOUT || display?.todayLayout)
  const Layout = LAYOUTS[id]
  if (!Layout) return <TodayView />
  return <Layout />
}
