/** The "@query" being typed at the caret, or undefined. The @ must start the text or follow
 * whitespace, so e-mail addresses and decorators do not open file suggestions. */
export function mentionQuery(text: string, caret: number) {
  const before = text.slice(0, caret)
  const match = /(^|\s)@([^\s@]*)$/.exec(before)
  if (!match) return undefined
  return { start: caret - match[2].length - 1, query: match[2] }
}

/** Replaces the mention at `start` with trigger + value + space; returns text and caret. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  value: string,
  trigger: '@' | '$' | '/' | '#' = '@',
) {
  const mention = `${trigger}${value} `
  return {
    text: text.slice(0, start) + mention + text.slice(caret),
    caret: start + mention.length,
  }
}

/** Ranks project paths for a query: contiguous matches in the file name beat matches in the
 * folder, which beat scattered letters. Case-insensitive; an empty query lists short paths. */
export function rankPaths(paths: readonly string[], query: string, limit = 8) {
  const needle = query.toLowerCase()
  const scored: { path: string; score: number }[] = []
  for (const path of paths) {
    const lower = path.toLowerCase()
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
    scored.push({ path, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((entry) => entry.path)
}
