import { createContext, useCallback, useContext, useState } from 'react'

// ViewContext - app-level current view + setter.
// Views: 'today' | 'photos' | 'music' | 'settings'.
// 'music' and 'settings' are stubbed in Phase 1.

const ViewContext = createContext({
  view: 'today',
  setView: () => {},
})

export function useView() {
  return useContext(ViewContext)
}

export function ViewProvider({ initialView = 'today', children }) {
  const [view, setViewState] = useState(initialView)
  // Stable setter so components can depend on it without retriggering.
  const setView = useCallback((next) => setViewState(next), [])
  return (
    <ViewContext.Provider value={{ view, setView }}>
      {children}
    </ViewContext.Provider>
  )
}
