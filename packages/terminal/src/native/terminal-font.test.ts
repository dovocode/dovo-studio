/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { expect, it } from 'vite-plus/test'
import {
  bundledTerminalFont,
  fontFallbackNotice,
  nativeFontFamilySupported,
  nativeTerminalFontFamily,
  unsupportedFontNotice,
} from './terminal-font'

it('maps the bundled Nerd Font preference to each platform loader', () => {
  expect(nativeTerminalFontFamily('ios', 'bundled-nerd')).toBe('JetBrainsMonoNL Nerd Font Mono')
  expect(nativeTerminalFontFamily('android', 'bundled-nerd')).toBe('JetBrainsMonoNLNerdFontMono')
})

it('maps the device default to a system monospace on both platforms', () => {
  expect(nativeTerminalFontFamily('ios', 'system')).toBe('Menlo')
  expect(nativeTerminalFontFamily('android', 'system')).toBe('')
})

it('only warns about an unpatched binary when its built-in font differs from the preference', () => {
  // iOS falls back to ghostty's embedded JetBrains Mono + Nerd symbols.
  expect(unsupportedFontNotice('ios', 'bundled-nerd')).toBe('')
  expect(unsupportedFontNotice('ios', 'system')).toMatch(/cannot change the terminal font/)
  // Android falls back to the system monospace.
  expect(unsupportedFontNotice('android', 'system')).toBe('')
  expect(unsupportedFontNotice('android', 'bundled-nerd')).toMatch(/system monospace/)
})

it('explains native font fallbacks', () => {
  expect(fontFallbackNotice('Font family X is not bundled in fonts/.')).toBe(
    'Font family X is not bundled in fonts/. Showing the default terminal font.',
  )
  expect(fontFallbackNotice('  ')).toBe(
    'The terminal font could not be loaded. Showing the default terminal font.',
  )
})

it('detects the patched fontFamily prop from the native view config', () => {
  expect(nativeFontFamilySupported(null)).toBe(false)
  expect(nativeFontFamilySupported({ validAttributes: { fontSize: true } })).toBe(false)
  expect(nativeFontFamilySupported({ validAttributes: { fontSize: true, fontFamily: true } })).toBe(
    true,
  )
})

it('bundles TTF files whose names and families match the native loaders', () => {
  for (const style of ['Regular', 'Bold']) {
    const bytes = readFileSync(
      new URL(`./fonts/${bundledTerminalFont.android}-${style}.ttf`, import.meta.url),
    )
    // TrueType outlines (Android cannot load woff2), carrying the CoreText family name.
    expect(bytes.readUInt32BE(0)).toBe(0x00010000)
    expect(bytes.includes(Buffer.from(bundledTerminalFont.ios, 'utf16le').swap16())).toBe(true)
  }
})
