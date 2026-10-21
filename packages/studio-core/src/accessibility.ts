import { semanticColors, colorVisionColors } from '@dovo/design'
import type { StudioThemeColors, StudioThemeMode } from './themes'

/** Status colors are paired with icons/text, never used as the sole state indicator. */
export function statusColors(
  mode: StudioThemeMode,
  colorVision: 'default' | 'blue-orange' = 'default',
): { success: string; error: string; warning: string; onError: string } {
  return { ...(colorVision === 'blue-orange' ? colorVisionColors[mode] : semanticColors[mode]) }
}

/** Neutral high-contrast surfaces keep code syntax colors independent. */
export function accessibleThemeColors(
  colors: StudioThemeColors,
  mode: StudioThemeMode,
  highContrast: boolean,
): StudioThemeColors {
  if (!highContrast) return colors
  const dark = mode === 'dark'
  return {
    ...colors,
    background: dark ? '#000000' : '#ffffff',
    sidebar: dark ? '#080808' : '#f8f8f8',
    card: dark ? '#101010' : '#ffffff',
    popover: dark ? '#101010' : '#ffffff',
    secondary: dark ? '#181818' : '#f0f0f0',
    selection: dark ? '#181818' : '#f0f0f0',
    foreground: dark ? '#ffffff' : '#000000',
    'muted-foreground': dark ? '#cccccc' : '#404040',
    border: dark ? '#888888' : '#777777',
    primary: dark ? '#9bd4ff' : '#005a9c',
    action: dark ? '#ffffff' : '#000000',
    'action-foreground': dark ? '#000000' : '#ffffff',
  }
}
