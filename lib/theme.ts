/**
 * Appearance preference, saved per device. 'system' follows the OS; the others pin a theme by
 * setting data-theme on <html>, which tokens.css reads. THEME_SCRIPT runs before first paint
 * (inlined in the root layout) so a saved dark theme never flashes light.
 */
export type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'theme'

export const THEME_SCRIPT = `try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`

export function getTheme(): ThemePref {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch { return 'system' }
}

export function setTheme(t: ThemePref) {
  try { if (t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t) } catch { /* private mode: still applies for this visit */ }
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
}
