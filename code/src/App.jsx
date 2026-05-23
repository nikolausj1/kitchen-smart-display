import AppShell from './shell/AppShell.jsx'

export default function App() {
  // AppShell owns view routing (Today / Photos / Music-stub / Settings-stub)
  // and menu-pill state. Individual views live under src/views/.
  return <AppShell />
}
