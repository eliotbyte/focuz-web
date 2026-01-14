import { useSyncExternalStore } from 'react'

export type ThemeMode = 'light' | 'dark'

const THEME_LS_KEY = 'focuz:theme'

function readTheme(): ThemeMode {
  const v = document.documentElement.dataset.theme
  return v === 'light' ? 'light' : 'dark'
}

export function getStoredTheme(): ThemeMode | undefined {
  try {
    const v = localStorage.getItem(THEME_LS_KEY)
    if (v === 'light' || v === 'dark') return v
    return undefined
  } catch {
    return undefined
  }
}

export function setStoredTheme(theme: ThemeMode): void {
  try { localStorage.setItem(THEME_LS_KEY, theme) } catch {}
  document.documentElement.dataset.theme = theme
}

export function applyStoredTheme(): ThemeMode {
  const stored = getStoredTheme()
  const next: ThemeMode = stored || readTheme() || 'dark'
  document.documentElement.dataset.theme = next
  return next
}

function subscribeTheme(cb: () => void): () => void {
  const el = document.documentElement
  const mo = new MutationObserver(() => cb())
  mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
  return () => mo.disconnect()
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribeTheme, readTheme, () => 'dark')
}

