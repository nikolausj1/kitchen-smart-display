import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Inter font - shipped inside the build so the kiosk renders correctly even
// if the Pi loses internet. Only the three weights actually used in designs.
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
