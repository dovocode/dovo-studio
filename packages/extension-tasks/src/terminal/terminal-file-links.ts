export type TerminalFileLink = { path: string; line: number; column?: number }
export type TerminalFileMatch = TerminalFileLink & { start: number; end: number }
/** Compiler locations only. Plain URLs and unqualified words are intentionally excluded. */
export function terminalFileLinks(text: string): TerminalFileMatch[] {
  const result: TerminalFileMatch[] = []
  // Exclude the entire URL, including ports and IPv6 brackets, before considering suffixes.
  const urls = [...text.matchAll(/[a-z][\w+.-]*:\/\/[^\s"'<>]+/gi)].map((url) => ({
    start: url.index,
    end: url.index + url[0].length,
  }))
  const pattern =
    /(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"'<>()[\]{},;]+?))(?::([1-9]\d*)(?::([1-9]\d*))?|\(([1-9]\d*)(?:,\s*([1-9]\d*))?\))/g
  for (const match of text.matchAll(pattern)) {
    if (urls.some((url) => match.index < url.end && match.index + match[0].length > url.start))
      continue
    const path = match[1] ?? match[2] ?? match[3]
    if (
      !path ||
      Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      /(?:^[a-z][\w+.-]*:\/\/|https?:|file:)/i.test(path)
    )
      continue
    if (!/[\\/.]/.test(path) || path === '.' || path === '..') continue
    const line = Number(match[4] ?? match[6]),
      column = match[5] ?? match[7]
    if (!Number.isSafeInteger(line) || (column && !Number.isSafeInteger(Number(column)))) continue
    result.push({
      path,
      line,
      ...(column ? { column: Number(column) } : {}),
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return result
}
