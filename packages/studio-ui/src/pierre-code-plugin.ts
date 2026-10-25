import type { CodeHighlighterPlugin, HighlightResult } from 'streamdown'
import { pierreTheme } from '@dovo/studio-core/pierre-theme'
import type { resolveCodeTheme } from '@dovo/studio-core/code-themes'

type SourceTheme = ReturnType<typeof resolveCodeTheme>
let engine: typeof import('@pierre/highlights') | undefined
let loading: Promise<typeof import('@pierre/highlights')> | undefined

/** Streamdown's plugin contract calls this slot "shiki"; the engine is always Pierre. */
export function createPierreCodePlugin(themes: [SourceTheme, SourceTheme]): CodeHighlighterPlugin {
  const palettes = { light: pierreTheme(themes[0]), dark: pierreTheme(themes[1]) }
  const highlight = (code: string, language: string): HighlightResult => {
    if (!engine) throw new Error('Pierre highlighting has not loaded')
    const result = engine.codeToTokens(code, {
      lang: engine.isSupportedLanguage(language) ? language : 'text',
      themes: palettes,
      cssVariablePrefix: '--shiki-',
      tokenizeMaxLineLength: 2000,
    })
    // Streamdown renders CSS styles, rather than Shiki's numeric font flags.
    return {
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
  }
  return {
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
}
