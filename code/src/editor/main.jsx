// The layout editor's entry (code/editor.html; served by the hub at
// /editor/). See docs/designs/layout-editor.md.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The same Inter the app ships (main.jsx), for the text block field, so what
// is typed looks like what the screen draws.
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import './editor.css'
import Editor from './Editor.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Editor />
  </StrictMode>
)
