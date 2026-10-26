import { cachedSyntax } from './syntax-cache'
import { createHighlighterCore } from '@shikijs/core'
import type {
  Awaitable,
  HighlighterCore,
  RegexEngine,
  ThemeRegistration,
  ThemedToken,
} from '@shikijs/types'

// Explicit imports let Metro collect only our supported grammars, including their dependencies.
const grammars = new Map(
  Object.entries({
    javascript: () => import('@shikijs/langs/javascript'),
    jsx: () => import('@shikijs/langs/jsx'),
    typescript: () => import('@shikijs/langs/typescript'),
    tsx: () => import('@shikijs/langs/tsx'),
    json: () => import('@shikijs/langs/json'),
    css: () => import('@shikijs/langs/css'),
    html: () => import('@shikijs/langs/html'),
    xml: () => import('@shikijs/langs/xml'),
    bash: () => import('@shikijs/langs/bash'),
    python: () => import('@shikijs/langs/python'),
    yaml: () => import('@shikijs/langs/yaml'),
    go: () => import('@shikijs/langs/go'),
    rust: () => import('@shikijs/langs/rust'),
    swift: () => import('@shikijs/langs/swift'),
    java: () => import('@shikijs/langs/java'),
    c: () => import('@shikijs/langs/c'),
    cpp: () => import('@shikijs/langs/cpp'),
    sql: () => import('@shikijs/langs/sql'),
    markdown: () => import('@shikijs/langs/markdown'),
  }),
)

const aliases: Readonly<Record<string, string>> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  htm: 'html',
  markup: 'html',
  svg: 'xml',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  zsh: 'bash',
  py: 'python',
  pyi: 'python',
  yml: 'yaml',
  rs: 'rust',
  h: 'c',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  md: 'markdown',
  mdx: 'markdown',
}

export function syntaxLanguage(value?: string): string | undefined {
  const name = value?.toLowerCase() ?? ''
  const language = aliases[name] ?? name
  return grammars.has(language) ? language : undefined
}

export function fileLanguage(path?: string) {
  const name = path?.split(/[\\/]/).pop()?.toLowerCase()
  if (name === '.bashrc' || name === '.zshrc') return 'bash'
  return syntaxLanguage(name?.split('.').pop())
}

export const maxSyntaxSourceLength = 64 * 1024
export type SyntaxTokenize = (content: string, language?: string) => ThemedToken[][] | undefined

/** One highlighter per app runtime; screens never own or dispose its shared scanners. */
export function createSyntaxHighlighter(engine: () => Awaitable<RegexEngine>) {
  let instance: Promise<HighlighterCore> | undefined
  const pendingLanguages = new Map<string, Promise<void>>()
  let previousTheme: ThemeRegistration | undefined
  let previousTokenize: SyntaxTokenize | undefined

  return async (
    languages: readonly string[],
    theme: ThemeRegistration & { name: string },
  ): Promise<SyntaxTokenize> => {
    instance ??= createHighlighterCore({ engine: engine(), langs: [], themes: [] }).catch(
      (error: unknown) => {
        instance = undefined
        throw error
      },
    )
    const highlighter = await instance
    await Promise.all(
      languages.map(async (language) => {
        const grammar = grammars.get(language)
        if (!grammar) return
        let pending = pendingLanguages.get(language)
        if (!pending) {
          pending = highlighter.loadLanguage(grammar).catch((error: unknown) => {
            pendingLanguages.delete(language)
            throw error
          })
          pendingLanguages.set(language, pending)
        }
        await pending
      }),
    )
    if (!highlighter.getLoadedThemes().includes(theme.name)) await highlighter.loadTheme(theme)
    if (previousTheme === theme && previousTokenize) return previousTokenize
    const tokenize = cachedSyntax((content, language) => {
      if (
        !language ||
        !highlighter.getLoadedLanguages().includes(language) ||
        content.length > maxSyntaxSourceLength
      )
        return undefined
      return highlighter.codeToTokensBase(content, {
        lang: language,
        theme: theme.name,
        tokenizeMaxLineLength: 2000,
      })
    })
    previousTheme = theme
    previousTokenize = tokenize
    return tokenize
  }
}
