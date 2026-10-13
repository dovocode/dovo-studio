import { useAppPreferences, useResolvedTheme } from '@dovo/studio-core'
import { studioThemes } from '@dovo/studio-core/themes'
import type { ArtifactPreviewTheme } from '@dovo/protocol'

export function useArtifactPreviewTheme(): ArtifactPreviewTheme {
  const { themePalette } = useAppPreferences()
  const mode = useResolvedTheme()
  const colors = studioThemes[themePalette][mode]
  return {
    mode,
    background: colors.background,
    foreground: colors.foreground,
    surface: colors.card,
    border: colors.border,
    accent: colors.primary,
  }
}
