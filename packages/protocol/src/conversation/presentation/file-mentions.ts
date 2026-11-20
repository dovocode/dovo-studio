import type { MentionTrigger } from './resource-mentions.js'

/** File picker trigger at the caret, including the bare @file shortcut. */
export function mentionQuery(text: string, caret: number) {
  const match = /(^|\s)@file(?::([^\s]*))?$/.exec(text.slice(0, caret))
  if (!match) return undefined
  return { start: match.index + match[1].length, query: match[2] ?? '' }
}

/** Match one complete explicit file token. The first group holds its leading boundary. */
const fileTokens = /(^|\s)@file:("(?:\\.|[^"\\])*"|[^\s"][^\s]*)(?=\s|$)/g

export function explicitFileMentions(text: string) {
  const files: { start: number; end: number; path: string }[] = []
  for (const match of text.matchAll(fileTokens)) {
    let path = match[2]
    if (path.startsWith('"')) {
      try {
        path = JSON.parse(path)
      } catch {
        continue
      }
    }
    files.push({ start: match.index + match[1].length, end: match.index + match[0].length, path })
  }
  return files
}

/** Keep UTF-16 offsets while hiding filenames from other mention parsers. */
export function maskFileMentions(text: string) {
  return text.replace(
    fileTokens,
    (token, space: string) => space + 'x'.repeat(token.length - space.length),
  )
}

/** Replaces the mention at `start` with trigger + value + space; returns text and caret. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  value: string,
  trigger: MentionTrigger = '@file:',
) {
  const token = trigger === '@file:' && /[\s"\\]/.test(value) ? JSON.stringify(value) : value
  const mention = `${trigger}${token} `
  return {
    text: text.slice(0, start) + mention + text.slice(caret),
    caret: start + mention.length,
  }
}

/** Ranks project paths for a query: contiguous matches in the file name beat matches in the
 * folder, which beat scattered letters. Case-insensitive; an empty query lists short paths. */
export function rankPaths(paths: readonly string[], query: string, limit = 8) {
  const count = Math.max(0, Math.trunc(limit))
  if (!count) return []
  const needle = query.toLowerCase()
  const scored: { path: string; score: number }[] = []
  const compare = (a: { path: string; score: number }, b: { path: string; score: number }) =>
    b.score - a.score || a.path.localeCompare(b.path)
  for (const path of paths) {
    const lower = needle ? path.toLowerCase() : ''
    const name = lower.slice(lower.lastIndexOf('/') + 1)
    let score: number
    if (!needle) score = 1000 - path.length
    else if (name.startsWith(needle)) score = 4000 - path.length
    else if (name.includes(needle)) score = 3000 - path.length
    else if (lower.includes(needle)) score = 2000 - path.length
    else {
      // Letters in order anywhere in the path, like "ctb" for "chat/composer-tabs.tsx".
      let at = 0
      for (const char of lower) if (char === needle[at]) at++
      if (at < needle.length) continue
      score = 1000 - path.length
    }
    const entry = { path, score }
    if (scored.length === count && compare(entry, scored[scored.length - 1]!) >= 0) continue
    let left = 0
    let right = scored.length
    while (left < right) {
      const middle = (left + right) >>> 1
      if (compare(entry, scored[middle]!) < 0) right = middle
      else left = middle + 1
    }
    scored.splice(left, 0, entry)
    if (scored.length > count) scored.pop()
  }
  return scored.map((entry) => entry.path)
}
