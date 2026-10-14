import Prism from 'prismjs'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-swift'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-cpp'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-markdown'
import { parsePatch } from 'diff'
import { diffRows, fileDiffRows, type DiffRow } from './diff-lines'

Prism.manual = true

export type SyntaxSpan = { text: string; kind?: string }
export type HighlightedDiffRow = DiffRow & { spans?: SyntaxSpan[] }

const languages: Readonly<Record<string, string>> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  css: 'css',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  sh: 'bash',
  bash: 'bash',
  py: 'python',
  pyi: 'python',
  yaml: 'yaml',
  yml: 'yaml',
  go: 'go',
  rs: 'rust',
  swift: 'swift',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  sql: 'sql',
  md: 'markdown',
}
export function diffLanguage(path?: string) {
  const extension = path?.split('.').pop()?.toLowerCase() ?? ''
  return languages[extension]
}
function grammar(path?: string) {
  const language = diffLanguage(path)
  return language ? Prism.languages[language] : undefined
}

/** Flatten nested tokens into lines without changing any source text or whitespace. */
function tokenLines(content: string, language: Prism.Grammar): SyntaxSpan[][] {
  const lines: SyntaxSpan[][] = [[]]
  function visit(token: Prism.TokenStream, kind?: string) {
    if (Array.isArray(token)) {
      for (const child of token) visit(child, kind)
    } else if (typeof token !== 'string') {
      visit(token.content, token.type)
    } else {
      const parts = token.split('\n')
      for (const [index, text] of parts.entries()) {
        if (index) lines.push([])
        if (!text) continue
        const line = lines[lines.length - 1]
        const previous = line[line.length - 1]
        if (previous && previous.kind === kind) previous.text += text
        else line.push({ text, kind })
      }
    }
  }
  visit(Prism.tokenize(content, language))
  return lines
}

/** Tokenize each side independently; omitted hunks must not carry lexical state forward. */
export function highlightedDiffRows(
  patch: string,
  path?: string,
  previousPath?: string,
): HighlightedDiffRow[] {
  // Keep large/generated patches readable without blocking the native JS thread with a tokenizer.
  let budget = 128 * 1024
  let files: ReturnType<typeof parsePatch>
  try {
    files = parsePatch(patch)
  } catch {
    return diffRows(patch)
  }
  const rows = files.flatMap((file) => {
    const result: HighlightedDiffRow[] = fileDiffRows(file)
    const oldGrammar = grammar(previousPath ?? path ?? file.oldFileName)
    const newGrammar = grammar(path ?? file.newFileName)
    const highlightHunk = (hunk: HighlightedDiffRow[]) => {
      for (const [side, language] of [
        ['old', oldGrammar],
        ['new', newGrammar],
      ] as const) {
        if (!language) continue
        const code = hunk.filter((row) =>
          side === 'old' ? row.before !== undefined : row.after !== undefined,
        )
        const size = code.reduce((total, row) => total + row.text.length + 1, 0)
        if (!size || size > 32 * 1024 || size > budget) continue
        budget -= size
        const lines = tokenLines(code.map((row) => row.text).join('\n'), language)
        code.forEach((row, index) => {
          // Context uses the new side; changed lines use their own side's lexical state.
          if (side === 'new' || row.kind === 'deletion') row.spans = lines[index]
        })
      }
    }
    let start = 0
    result.forEach((row, index) => {
      if (!row.text.startsWith('@@') || row.kind !== 'header') return
      highlightHunk(result.slice(start, index))
      start = index + 1
    })
    highlightHunk(result.slice(start))
    return result
  })
  return rows.length ? rows : diffRows(patch)
}
