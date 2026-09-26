import { createContext } from 'react'

// PanelTitleContext - a box's title override (the universal `title` of a
// layout spec, layoutSpec.js BOX_SCHEMA), handed by Entry/SpecPanel to the
// PanelFrame inside it: null (the panel's own header, as always),
// { mode: 'custom', text } (that text in the header's title slot) or
// { mode: 'none' } (no header row). Outside a spec layout nothing provides
// it, and every PanelFrame draws its own title exactly as before.
export const PanelTitleContext = createContext(null)
