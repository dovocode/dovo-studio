import type { CodeHighlighterPlugin, HighlightResult } from 'streamdown'
import { pierreTheme } from '@dovo/studio-core/pierre-theme'
import type { resolveCodeTheme } from '@dovo/studio-core/code-themes'

type SourceTheme = ReturnType<typeof resolveCodeTheme>
let engine: typeof import('@pierre/highlights') | undefined
let loading: Promise<typeof import('@pierre/highlights')> | undefined
// Reopening a message can reuse its palette's tokens. Weak keys release removed imports;
// edited imports have a new identity even when they keep the same theme name.
const plugins = new WeakMap<SourceTheme, WeakMap<SourceTheme, CodeHighlighterPlugin>>()

/** Streamdown's plugin contract calls this slot "shiki"; the engine is always Pierre. */
export function createPierreCodePlugin(themes: [SourceTheme, SourceTheme]): CodeHighlighterPlugin {
  const existing = plugins.get(themes[0])?.get(themes[1])
  if (existing) return existing
  const palettes = { light: pierreTheme(themes[0]), dark: pierreTheme(themes[1]) }
  const entries = new Map<string, { result: HighlightResult; bytes: number }>()
  let retainedBytes = 0
  const highlight = (code: string, language: string): HighlightResult => {
    if (!engine) throw new Error('Pierre highlighting has not loaded')
    const lang = engine.isSupportedLanguage(language) ? language : 'text'
    const key = `${lang}\0${code}`
    const cached = entries.get(key)
    if (cached) {
      entries.delete(key)
      entries.set(key, cached)
      return cached.result
    }
    const result = engine.codeToTokens(code, {
      lang,
      themes: palettes,
      cssVariablePrefix: '--shiki-',
      tokenizeMaxLineLength: 2000,
    })
    // Streamdown renders CSS styles, rather than Shiki's numeric font flags.
    const highlighted = {
      ...result,
      tokens: result.tokens.map((line) =>
        line.map((token) => {
          const htmlStyle = { ...token.htmlStyle }
          const fontStyle =
            htmlStyle['font-style'] ?? ((token.fontStyle ?? 0) & 1 ? 'italic' : 'normal')
          const fontWeight =
            htmlStyle['font-weight'] ?? ((token.fontStyle ?? 0) & 2 ? '700' : '400')
          // React expects camelCase inline styles. CSS below handles both color modes
          // instead of pinning an inline font style from the default (light) palette.
          delete htmlStyle['font-style']
          delete htmlStyle['font-weight']
          return {
            ...token,
            htmlStyle: {
              ...htmlStyle,
              '--shiki-light-font-style': fontStyle,
              '--shiki-light-font-weight': fontWeight,
            },
          }
        }),
      ),
    }
    // Estimate source, keys, lines and styled token objects; never retain an oversized block.
    // Both limits matter for streaming, where every growing prefix has a different key.
    const bytes =
      key.length * 4 + highlighted.tokens.reduce((sum, line) => sum + 32 + line.length * 256, 0)
    const budget = 1024 * 1024
    if (bytes <= budget) {
      while (entries.size >= 20 || retainedBytes + bytes > budget) {
        const oldest = entries.entries().next().value
        if (!oldest) break
        entries.delete(oldest[0])
        retainedBytes -= oldest[1].bytes
      }
      entries.set(key, { result: highlighted, bytes })
      retainedBytes += bytes
    }
    return highlighted
  }
  const plugin: CodeHighlighterPlugin = {
    type: 'code-highlighter',
    name: 'shiki',
    getThemes: () => themes,
    // Common editor choices; Pierre also accepts its other supported languages and aliases.
    getSupportedLanguages: () => [
      'text',
      'javascript',
      'typescript',
      'jsx',
      'tsx',
      'json',
      'css',
      'html',
      'xml',
      'bash',
      'python',
      'yaml',
      'go',
      'rust',
      'swift',
      'java',
      'c',
      'cpp',
      'sql',
      'markdown',
    ],
    // Unknown languages use Pierre's literal-text mode, retaining the chosen palette.
    supportsLanguage: () => true,
    highlight({ code, language }, callback) {
      if (engine) return highlight(code, language)
      loading ??= import('@pierre/highlights').then((value) => {
        engine = value
        return value
      })
      void loading
        .then(() => callback?.(highlight(code, language)))
        .catch((error: unknown) => {
          console.error('Could not load Pierre code highlighting', error)
        })
      return null
    },
  }
  let darkThemes = plugins.get(themes[0])
  if (!darkThemes) {
    darkThemes = new WeakMap()
    plugins.set(themes[0], darkThemes)
  }
  darkThemes.set(themes[1], plugin)
  return plugin
}
