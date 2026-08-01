import { useCallback, useSyncExternalStore } from 'react'

const THEME_KEY = 'muney.theme'
const listeners = new Set<() => void>()

function isDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function apply(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark)
  try {
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
  } catch {
    /* storage blocked — the class is still applied for this session */
  }
  listeners.forEach((listener) => listener())
}

/**
 * The initial value is set by the inline script in index.html before first
 * paint; this hook only reads and flips it, so there is no flash and no
 * second source of truth.
 */
export function useTheme(): { dark: boolean; toggle: () => void } {
  const dark = useSyncExternalStore(subscribe, isDark, () => true)
  const toggle = useCallback(() => apply(!isDark()), [])
  return { dark, toggle }
}
