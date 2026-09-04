import TodayView from '../TodayView/TodayView.jsx'
import PlaceholderLayout from './PlaceholderLayout.jsx'
import AmbientLayout from './Ambient/AmbientLayout.jsx'
import { useSettings } from '../../lib/settings.js'
import { REQUESTED_LAYOUT } from '../../lib/kioskMode.js'
import { normalizeLayoutId, LAYOUT_LABELS } from './registry.js'

// TodayLayoutSwitch - picks which Today to render. 'framed' is the original
// TodayView, untouched. Anything else is one of the new layouts in this
// folder. A ?layout= URL param wins for the page load without being saved.
//
// Stage 2 replaces the placeholders with the real compositions.
const LAYOUTS = {
  board: () => <PlaceholderLayout name={LAYOUT_LABELS.board} />,
  briefing: () => <PlaceholderLayout name={LAYOUT_LABELS.briefing} />,
  ambient: AmbientLayout,
}

export default function TodayLayoutSwitch() {
  const { display } = useSettings()
  const id = normalizeLayoutId(REQUESTED_LAYOUT || display?.todayLayout)
  const Layout = LAYOUTS[id]
  if (!Layout) return <TodayView />
  return <Layout />
}
