import { useEffect } from 'react'
import { useAppPreferences } from '@dovo/studio-core'

/** Applies Settings → Appearance to the document; "System" follows the OS live. */
export function useAppearance() {
  const { theme, textSize, motion } = useAppPreferences()
  useEffect(() => {
    const root = document.documentElement
    root.dataset.textSize = textSize
    root.dataset.motion = motion
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      root.dataset.theme = theme === 'system' ? (media.matches ? 'light' : 'dark') : theme
    }
    apply()
    if (theme !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme, textSize, motion])
}
