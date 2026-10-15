import { parsePatch } from 'diff'
import type { ThemedToken } from '@shikijs/types'
import {
  fileLanguage,
  maxSyntaxSourceLength,
  type SyntaxTokenize,
} from '../../ui/content/syntax-highlighter'
import { diffRows, fileDiffRows, type DiffRow } from './diff-lines'

export type HighlightedDiffRow = DiffRow & { spans?: ThemedToken[] }

function rowTokens(tokens: ThemedToken[] | undefined, text: string) {
  if (!tokens) return undefined
  const content = tokens.map((token) => token.content).join('')
  if (content === text) return tokens
  // Shiki removes CRLF terminators; jsdiff retains CR as part of each patch line.
  if (`${content}\r` === text) {
    const last = tokens.at(-1)
    return [...tokens, { content: '\r', offset: (last?.offset ?? 0) + (last?.content.length ?? 0) }]
  }
  return undefined
}

/** Resolve grammar names from patch headers as well as explicit rename paths. */
export function diffLanguages(patch: string, path?: string, previousPath?: string) {
  try {
    return parsePatch(patch).flatMap((file) => [
      fileLanguage(previousPath ?? path ?? file.oldFileName),
      fileLanguage(path ?? file.newFileName),
    ])
  } catch {
    return []
  }
}

/** Tokenize each side independently; omitted hunks must not carry lexical state forward. */
export function highlightedDiffRows(
  patch: string,
  path?: string,
  previousPath?: string,
  tokenize?: SyntaxTokenize,
  source?: { before?: string; after?: string },
): HighlightedDiffRow[] {
  if (!tokenize) return diffRows(patch)
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
    const oldLanguage = fileLanguage(previousPath ?? path ?? file.oldFileName)
    const newLanguage = fileLanguage(path ?? file.newFileName)
    for (const [side, language] of [
      ['old', oldLanguage],
      ['new', newLanguage],
    ] as const) {
      if (!language) continue
      const content =
        files.length === 1 ? (side === 'old' ? source?.before : source?.after) : undefined
      if (content !== undefined) {
        // If a complete file exceeds the budget, leave it plain rather than guessing its state.
        if (content.length > maxSyntaxSourceLength || content.length > budget) continue
        budget -= content.length
        const lines = tokenize(content, language)
        for (const row of result) {
          const number = side === 'old' ? row.before : row.after
          const tokens = rowTokens(number === undefined ? undefined : lines?.[number - 1], row.text)
          // Never map stale/full-file tokens onto different patch contents.
          if (tokens && (side === 'new' || row.kind === 'deletion')) row.spans = tokens
        }
        continue
      }
      const highlightHunk = (hunk: HighlightedDiffRow[]) => {
        const code = hunk.filter((row) =>
          side === 'old' ? row.before !== undefined : row.after !== undefined,
        )
        const size = code.reduce((total, row) => total + row.text.length + 1, 0)
        if (!size || size > 32 * 1024 || size > budget) return
        budget -= size
        const lines = tokenize(code.map((row) => row.text).join('\n'), language)
        code.forEach((row, index) => {
          if (side === 'new' || row.kind === 'deletion')
            row.spans = rowTokens(lines?.[index], row.text)
        })
      }
      let start = 0
      result.forEach((row, index) => {
        if (!row.text.startsWith('@@') || row.kind !== 'header') return
        highlightHunk(result.slice(start, index))
        start = index + 1
      })
      highlightHunk(result.slice(start))
    }
    return result
  })
  return rows.length ? rows : diffRows(patch)
}
