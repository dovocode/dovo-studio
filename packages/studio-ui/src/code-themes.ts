import { studioSyntaxTheme, studioThemeIds } from '@dovo/studio-core'
import { preloadHighlighter, registerCustomTheme, type SupportedLanguages } from '@pierre/diffs'

const themes = studioThemeIds.flatMap((id) =>
  (['light', 'dark'] as const).map((mode) => {
    const theme = studioSyntaxTheme(id, mode)
    registerCustomTheme(theme.name, () => Promise.resolve(theme))
    return theme.name
  }),
)

/** Prepare every palette once so live theme changes preserve diff/editor state. */
export function preloadStudioHighlighter(language: SupportedLanguages) {
  return preloadHighlighter({ themes, langs: [language] })
}
