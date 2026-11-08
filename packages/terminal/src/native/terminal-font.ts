/**
 * Terminal font selection for the native libghostty renderer.
 *
 * The `fontFamily` prop comes from patches/expo-libghostty@0.8.1.patch (repo root). The bundled Nerd Font
 * ships as ./fonts/JetBrainsMonoNLNerdFontMono-*.ttf (lossless conversions of the web woff2
 * files) and must be registered by the host app, e.g. with the expo-font config plugin:
 * UIAppFonts on iOS, assets/fonts/ on Android.
 */
export type NativeTerminalFont = 'system' | 'bundled-nerd'
export type NativeTerminalPlatform = 'ios' | 'android'

export const bundledTerminalFont = {
  /** CoreText family (typographic family name, name ID 16) of the bundled TTFs. */
  ios: 'JetBrainsMonoNL Nerd Font Mono',
  /** Android asset stem: fonts/<stem>-Regular.ttf and fonts/<stem>-Bold.ttf. */
  android: 'JetBrainsMonoNLNerdFontMono',
} as const

/** Display name of the bundled font, matching the web terminal's family. */
export const bundledTerminalFontName = 'JetBrains Mono Nerd Font'

/** iOS system monospace that CoreText can resolve by name (SF Mono is not addressable). */
export const iosSystemMonospace = 'Menlo'

/** The native `fontFamily` value for a font choice. Empty selects Android's system monospace. */
export function nativeTerminalFontFamily(
  platform: NativeTerminalPlatform,
  font: NativeTerminalFont,
) {
  if (font === 'bundled-nerd') return bundledTerminalFont[platform]
  return platform === 'ios' ? iosSystemMonospace : ''
}

/**
 * Without the native `fontFamily` prop (an app binary built before the patch), each platform
 * renders its built-in default: ghostty's embedded JetBrains Mono with Nerd Font symbols on
 * iOS, and the system monospace (plus bundled Nerd symbols) on Android. Returns a notice when
 * that default does not match the choice, so a preference is never silently ignored.
 */
export function unsupportedFontNotice(platform: NativeTerminalPlatform, font: NativeTerminalFont) {
  const nerd = font === 'bundled-nerd'
  if (platform === 'ios' ? !nerd : nerd)
    return `This app build cannot change the terminal font; showing ${platform === 'ios' ? bundledTerminalFontName : 'the system monospace font'} instead.`
  return ''
}

export function fontFallbackNotice(message: string) {
  return `${message.trim() || 'The terminal font could not be loaded.'} Showing the default terminal font.`
}

/** Whether the installed native view accepts the patched `fontFamily` prop. */
export function nativeFontFamilySupported(
  viewConfig: { validAttributes?: Record<string, unknown> } | null | undefined,
) {
  return !!viewConfig?.validAttributes && 'fontFamily' in viewConfig.validAttributes
}
