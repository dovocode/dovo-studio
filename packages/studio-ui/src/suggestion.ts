export function suggestionComment(body: string, replacement: string) {
  const fence = '`'.repeat(
    Math.max(3, ...Array.from(replacement.matchAll(/`+/g), (m) => m[0].length + 1)),
  )
  return `${body.trim() ? body.trim() + '\n\n' : ''}${fence}suggestion\n${replacement ? replacement + '\n' : ''}${fence}`
}
