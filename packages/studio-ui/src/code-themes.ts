import {
  studioSyntaxTheme,
  studioThemeIds,
  readAppPreferences,
  useAppPreferences,
  useDiffOptions as useCoreDiffOptions,
} from '@dovo/studio-core'
import { preloadHighlighter, registerCustomTheme, type SupportedLanguages } from '@pierre/diffs'

const themes = studioThemeIds.flatMap((id) =>
  (['light', 'dark'] as const).map((mode) => {
    const theme = studioSyntaxTheme(id, mode)
    registerCustomTheme(theme.name, () => Promise.resolve(theme))
    return theme.name
  }),
)

const registered = new Set(themes)
function registerImportedThemes(
  imported: ReturnType<typeof readAppPreferences>['importedCodeThemes'],
) {
  for (const theme of imported) {
    if (registered.has(theme.name)) continue
    registerCustomTheme(theme.name, () => Promise.resolve(theme))
    registered.add(theme.name)
  }
}

/** Register definitions before a renderer sees their names. */
export function useDiffOptions() {
  const { importedCodeThemes } = useAppPreferences()
  registerImportedThemes(importedCodeThemes)
  return useCoreDiffOptions()
}

/** Prepare every palette once so live theme changes preserve diff/editor state. */
export function preloadStudioHighlighter(language: SupportedLanguages) {
  const { importedCodeThemes } = readAppPreferences()
  registerImportedThemes(importedCodeThemes)
  return preloadHighlighter({
    themes: [...themes, ...importedCodeThemes.map((theme) => theme.name)],
    langs: [language],
  })
}
