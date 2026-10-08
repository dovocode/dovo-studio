import { useLayoutEffect } from 'react'
import {
  useAppPreferences,
  useResolvedTheme,
  useStudioTheme,
  fontStack,
  systemAppFont,
  systemMonoFont,
} from '@dovo/studio-core'

/** Colours for native window chrome the document cannot paint: the title bar strip and the
 * caption buttons on Windows and Linux. */
export type WindowColors = { background: string; symbol: string }
/** Applies Settings → Appearance to the document; "System" follows the OS live. The desktop
 * app receives the title bar palette so its native window controls follow the theme. */
export function useAppearance(onWindowColors?: (colors: WindowColors) => unknown) {
  const { themePalette, textSize, motion, chatWidth, appFontFamily, codeFontFamily } =
    useAppPreferences()
  const mode = useResolvedTheme()
  const colors = useStudioTheme()
  useLayoutEffect(() => {
    void Promise.resolve(
      onWindowColors?.({ background: colors.sidebar, symbol: colors['muted-foreground'] }),
    ).catch((error: unknown) => console.warn('Could not update window colours', error))
  }, [colors, onWindowColors])
  useLayoutEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--app-font-family', fontStack(appFontFamily, systemAppFont))
    root.style.setProperty('--code-font-family', fontStack(codeFontFamily, systemMonoFont))
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
  }, [mode, themePalette, colors, textSize, motion, chatWidth, appFontFamily, codeFontFamily])
}
