import { pierreTheme } from '@dovo/studio-core/pierre-theme'
import { resolveCodeTheme } from '@dovo/studio-core/code-themes'
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
    registerCustomTheme(theme.name, () => Promise.resolve(pierreTheme(theme)), 'zed')
    return theme.name
  }),
)

const registered = new Set(themes)
function registerImportedThemes(
  imported: ReturnType<typeof readAppPreferences>['importedCodeThemes'],
) {
  for (const theme of imported) {
    if (registered.has(theme.name)) continue
    registerCustomTheme(theme.name, () => Promise.resolve(pierreTheme(theme)), 'zed')
    registered.add(theme.name)
  }
}

/** Register definitions before a renderer sees their names. */
export function useDiffOptions() {
  const { importedCodeThemes } = useAppPreferences()
  registerImportedThemes(importedCodeThemes)
  return useCoreDiffOptions()
}

/** Prepare the active palette; Pierre resolves other registered palettes on theme changes. */
export function preloadStudioHighlighter(language: SupportedLanguages) {
  const preferences = readAppPreferences()
  registerImportedThemes(preferences.importedCodeThemes)
  const mode =
    preferences.theme === 'system'
      ? globalThis.matchMedia?.('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : preferences.theme
  const theme = resolveCodeTheme(
    preferences.codeTheme,
    preferences.importedCodeThemes,
    preferences.themePalette,
    mode,
  )
  return preloadHighlighter({
    preferredHighlighter: 'highlights',
    themes: [theme.name],
    langs: [language],
  })
}
