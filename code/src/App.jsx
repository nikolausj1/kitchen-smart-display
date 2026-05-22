import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const time = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const date = now.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <main className="placeholder">
      <h1>Kitchen Display</h1>
      <p className="greeting">Hello from {window.location.hostname}</p>
      <p className="clock">{time}</p>
      <p className="date">{date}</p>
      <p className="note">Toolchain placeholder. Real views come next.</p>
    </main>
  )
}

export default App
