export type CodeBlock = { language: string; code: string }

/** Fenced code blocks (``` or ~~~) in a Markdown message, in order. An unclosed fence, as in a
 * reply that is still streaming, runs to the end of the message. */
export function fencedCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  let open: { marker: string; size: number; language: string; lines: string[] } | undefined
  for (const line of markdown.split(/\r?\n/)) {
    if (!open) {
      const fence = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/.exec(line)
      if (fence)
        open = { marker: fence[1][0], size: fence[1].length, language: fence[2], lines: [] }
      continue
    }
    const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
    if (close && close[1][0] === open.marker && close[1].length >= open.size) {
      blocks.push({ language: open.language, code: open.lines.join('\n') })
      open = undefined
      continue
    }
    open.lines.push(line)
  }
  if (open) blocks.push({ language: open.language, code: open.lines.join('\n') })
  return blocks.filter((block) => block.code.trim())
}

/** A short, recognisable label for choosing between several blocks. */
export function codeBlockLabel(block: CodeBlock, index: number) {
  const first = block.code.trim().split('\n')[0]?.trim() ?? ''
  const preview = first.length > 32 ? `${first.slice(0, 31)}…` : first
  return `${block.language || `Block ${index + 1}`}: ${preview}`
}

const shells = new Set([
  'sh',
  'bash',
  'zsh',
  'shell',
  'console',
  'fish',
  'terminal',
  'shellsession',
])
/** The command to run for a shell block, or undefined when the block is not a shell command.
 * Console transcripts ("$ cmd" followed by output) keep only the prompted lines. */
export function shellCommand(block: CodeBlock): string | undefined {
  const lines = block.code.split('\n')
  const prompted = lines.filter((line) => /^\s*\$ /.test(line))
  const language = block.language.toLowerCase()
  if (prompted.length && (language === 'console' || language === 'shellsession' || !language))
    return prompted.map((line) => line.replace(/^\s*\$ /, '')).join('\n')
  if (!shells.has(language)) return undefined
  const command = block.code.trim()
  return command || undefined
}
