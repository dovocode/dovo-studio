import { Schema } from 'effect'

/** One family name, not raw CSS. Empty means the device default. */
export const fontFamilySchema = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(100)),
  Schema.check(
    Schema.makeFilter(
      (family) =>
        Array.from(family).every((character) => {
          const code = character.charCodeAt(0)
          return code >= 32 && code !== 127
        }),
      { message: 'Font family must not contain control characters' },
    ),
  ),
)
export const terminalFontSizeSchema = Schema.Number.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 8, maximum: 32 })),
)
export const nerdFontFamily = 'JetBrains Mono Nerd Font'
export const systemMonoFont = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
export const systemAppFont =
  'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const genericFamilies = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'system-ui',
  'ui-sans-serif',
  'ui-monospace',
  'ui-serif',
])

/** Quote installed family names so commas/quotes cannot change the CSS font stack. */
export function fontStack(family: string, fallback: string) {
  const name = family.trim()
  if (!name) return fallback
  return `${genericFamilies.has(name) ? name : JSON.stringify(name)}, ${fallback}`
}
