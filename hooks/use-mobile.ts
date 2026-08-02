import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/**
 * Is the viewport phone-sized?
 *
 * useSyncExternalStore rather than useState + useEffect. matchMedia IS an external store, and
 * this is the hook React provides for reading one: it subscribes, re-reads on change, and
 * gives the server a defined answer without the synchronous setState inside an effect that
 * the shadcn default used (which triggers a cascading render).
 */
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

const getSnapshot = () => window.matchMedia(QUERY).matches

// The server has no viewport. Desktop is the safer guess: the mobile layout hides the sidebar
// behind a sheet, and rendering that on a desktop first paint is more jarring than the
// reverse.
const getServerSnapshot = () => false

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
