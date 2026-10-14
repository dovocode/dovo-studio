import { Schema } from 'effect'
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser'
import { sha256 } from '@noble/hashes/sha2.js'
import { decodeResult, mutableArray, mutableStruct } from '@dovo/protocol'
import {
  studioSyntaxTheme,
  studioThemeIds,
  type StudioThemeId,
  type StudioThemeMode,
} from './themes'

export const maxCodeThemeBytes = 1024 * 1024
const text = Schema.String.pipe(Schema.check(Schema.isMaxLength(256)))
const color = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) => /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value),
      { message: 'Theme colors must be hexadecimal colors' },
    ),
  ),
)
const tokenSchema = mutableStruct({
  scope: Schema.optional(
    Schema.Union([
      Schema.String.pipe(Schema.check(Schema.isMaxLength(8192))),
      mutableArray(text).pipe(Schema.check(Schema.isMaxLength(512))),
    ]),
  ),
  settings: mutableStruct({
    foreground: Schema.optional(color),
    background: Schema.optional(color),
    fontStyle: Schema.optional(
      Schema.String.pipe(
        Schema.check(
          Schema.makeFilter((value) =>
            value
              .split(/\s+/)
              .every((style) =>
                ['', 'normal', 'regular', 'italic', 'bold', 'underline', 'strikethrough'].includes(
                  style,
                ),
              ),
          ),
        ),
      ),
    ),
  }),
})
const sourceSchema = mutableStruct({
  name: Schema.optional(text),
  type: Schema.optional(Schema.Literals(['dark', 'light', 'hc', 'hcLight'])),
  include: Schema.optional(Schema.String),
  colors: Schema.optional(Schema.Record(Schema.String, Schema.NullOr(color))),
  tokenColors: Schema.optional(
    mutableArray(tokenSchema).pipe(Schema.check(Schema.isMaxLength(4096))),
  ),
})
export const importedCodeThemeSchema = mutableStruct({
  name: text,
  label: text,
  type: Schema.Literals(['dark', 'light']),
  fg: color,
  bg: color,
  colors: Schema.Record(Schema.String, color),
  tokenColors: mutableArray(tokenSchema).pipe(Schema.check(Schema.isMaxLength(4096))),
  source: Schema.optional(
    mutableStruct({
      registry: Schema.Literal('open-vsx'),
      publisher: text,
      extension: text,
      version: text,
      license: Schema.optional(text),
    }),
  ),
})
export const importedCodeThemesSchema = mutableArray(importedCodeThemeSchema).pipe(
  Schema.check(Schema.isMaxLength(20)),
)
export type ImportedCodeTheme = Schema.Schema.Type<typeof importedCodeThemeSchema>
export const codeThemeSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) =>
        value === 'app' ||
        studioThemeIds.some((id) => id === value) ||
        /^dovo-import-[a-f0-9]{64}$/.test(value),
    ),
  ),
)

function isLightColor(color: string) {
  const hex = color.slice(1)
  const expanded = hex.length <= 4 ? Array.from(hex, (digit) => digit + digit).join('') : hex
  return (
    [0.299, 0.587, 0.114].reduce(
      (sum, weight, index) =>
        sum + weight * Number.parseInt(expanded.slice(index * 2, index * 2 + 2), 16),
      0,
    ) > 127
  )
}

/** Parse theme data without following references or executing extension code. */
export function parseCodeThemeSource(contents: string) {
  if (new TextEncoder().encode(contents).byteLength > maxCodeThemeBytes)
    throw new Error('Choose a theme file smaller than 1 MB.')
  const errors: ParseError[] = []
  const raw: unknown = parse(contents, errors, { allowTrailingComma: true })
  if (errors.length) throw new Error(`Invalid theme JSON: ${printParseErrorCode(errors[0].error)}.`)
  const result = decodeResult(sourceSchema, raw)
  if (!result.success)
    throw new Error('Invalid VS Code theme. Check colors, scopes and token settings.')
  return result.data
}

/** Standalone VS Code JSON/JSONC themes; never execute extension code or fetch includes. */
export function importCodeTheme(contents: string, filename: string): ImportedCodeTheme {
  const source = parseCodeThemeSource(contents)
  if (source.include !== undefined)
    throw new Error(
      'This theme includes another file. In VS Code, run “Developer: Generate Color Theme From Current Settings” and import the exported JSON.',
    )
  if (!source.colors && !source.tokenColors?.length)
    throw new Error('This file contains no theme colors.')
  const colors = Object.fromEntries(
    Object.entries(source.colors ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== null,
    ),
  )
  const defaults = source.tokenColors
    ?.filter((token) => !token.scope)
    .reduce<{ foreground?: string; background?: string }>(
      (settings, token) => ({ ...settings, ...token.settings }),
      {},
    )
  const background = colors['editor.background'] ?? defaults?.background
  const inferredMode = background && isLightColor(background) ? 'light' : 'dark'
  const type =
    source.type === undefined
      ? inferredMode
      : source.type === 'light' || source.type === 'hcLight'
        ? 'light'
        : 'dark'
  const fallback = studioSyntaxTheme('vscode', type)
  const fg = colors['editor.foreground'] ?? defaults?.foreground ?? fallback.fg
  const bg = colors['editor.background'] ?? defaults?.background ?? fallback.bg
  const label = (
    source.name?.trim() ||
    filename.replace(/\.jsonc?$/i, '') ||
    'Imported theme'
  ).slice(0, 256)
  const definition = {
    label,
    type,
    fg,
    bg,
    colors: { ...colors, 'editor.foreground': fg, 'editor.background': bg },
    tokenColors: (source.tokenColors ?? []).map((token) => ({
      ...token,
      settings: {
        ...token.settings,
        ...(token.settings.fontStyle !== undefined
          ? {
              fontStyle: token.settings.fontStyle
                .split(/\s+/)
                .filter((style) => style !== 'normal' && style !== 'regular')
                .join(' '),
            }
          : {}),
      },
    })),
  }
  const hash = Array.from(sha256(new TextEncoder().encode(JSON.stringify(definition))), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return { ...definition, type, name: `dovo-import-${hash}` }
}

export function addImportedCodeTheme(
  existing: readonly ImportedCodeTheme[],
  theme: ImportedCodeTheme,
) {
  const current = existing.filter((item) => item.name !== theme.name)
  if (current.length >= 20)
    throw new Error('Remove an imported theme before adding another (maximum 20).')
  return [...current, theme]
}

export function resolveCodeTheme(
  selection: string,
  imported: readonly ImportedCodeTheme[],
  palette: StudioThemeId,
  mode: StudioThemeMode,
) {
  const custom = imported.find((theme) => theme.name === selection)
  if (custom) return custom
  const selectedPalette = studioThemeIds.find((id) => id === selection) ?? palette
  return studioSyntaxTheme(selectedPalette, mode)
}

/** Native Prism renderers map their token categories onto TextMate theme scopes. */
export function nativeCodeColors(theme: ReturnType<typeof resolveCodeTheme>) {
  const token = (scope: string) => {
    let value = theme.fg
    let specificity = 0
    for (const rule of theme.tokenColors) {
      const scopes =
        typeof rule.scope === 'string'
          ? rule.scope.split(',').map((part) => part.trim())
          : (rule.scope ?? [])
      for (const part of scopes) {
        if (
          (scope === part || scope.startsWith(`${part}.`)) &&
          part.length >= specificity &&
          rule.settings.foreground
        ) {
          value = rule.settings.foreground
          specificity = part.length
        }
      }
    }
    return value
  }
  return {
    background: theme.bg,
    text: theme.fg,
    selection:
      theme.colors['editor.selectionBackground'] ?? (theme.type === 'dark' ? '#264f78' : '#add6ff'),
    addition: theme.type === 'dark' ? '#8ad5b0' : '#087f5b',
    deletion: theme.type === 'dark' ? '#ff7e97' : '#ba2549',
    comment: token('comment'),
    keyword: token('keyword'),
    string: token('string'),
    number: token('constant.numeric'),
    function: token('entity.name.function'),
    type: token('entity.name.type'),
    gutter: theme.colors['editorLineNumber.foreground'] ?? token('comment'),
  }
}
