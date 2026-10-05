import { useLayoutEffect } from 'react'
import { useAppPreferences, useResolvedTheme, useStudioTheme } from '@dovo/studio-core'

/** Applies Settings → Appearance to the document; "System" follows the OS live. */
export function useAppearance() {
  const { themePalette, textSize, motion, chatWidth } = useAppPreferences()
  const mode = useResolvedTheme()
  const colors = useStudioTheme()
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.textSize = textSize
    root.dataset.motion = motion
    root.dataset.chatWidth = chatWidth
    root.dataset.theme = mode
    root.dataset.themePalette = themePalette
    root.classList.toggle('dark', mode === 'dark')
    for (const [name, value] of Object.entries(colors)) root.style.setProperty(`--${name}`, value)
    root.style.setProperty('--primary-foreground', mode === 'dark' ? colors.background : '#ffffff')
    root.style.setProperty('--muted', colors.card)
    root.style.setProperty('--accent', colors.selection)
    root.style.setProperty('--ring', colors.primary)
    root.style.setProperty('--destructive', mode === 'dark' ? '#ff7e97' : '#ba2549')
    root.style.setProperty('--destructive-foreground', mode === 'dark' ? '#341520' : '#ffffff')
  }, [mode, themePalette, colors, textSize, motion, chatWidth])
}
