function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

function text(value: unknown) {
  if (typeof value === 'string') return value
  return Array.isArray(value) && value.every((line) => typeof line === 'string')
    ? value.join('')
    : ''
}

function code(value: string) {
  let longest = 2
  for (const run of value.matchAll(/~{3,}/g)) longest = Math.max(longest, run[0].length)
  const fence = '~'.repeat(longest + 1)
  return `${fence}\n${value}\n${fence}`
}

/** Notebook previews run no cells and use the normal Markdown renderer for text output. */
export function notebookMarkdown(contents: string) {
  let notebook: Record<string, unknown>
  try {
    notebook = record(JSON.parse(contents))
  } catch {
    return
  }
  if (notebook.nbformat !== 4 || !Array.isArray(notebook.cells)) return
  const blocks: string[] = []
  for (const value of notebook.cells) {
    const cell = record(value)
    const source = text(cell.source)
    if (source) blocks.push(cell.cell_type === 'markdown' ? source : code(source))
    if (!Array.isArray(cell.outputs)) continue
    for (const output of cell.outputs.map(record)) {
      const data = record(output.data)
      const markdown = text(data['text/markdown'])
      const plain = text(data['text/plain']) || text(output.text) || text(output.traceback)
      if (markdown) blocks.push(markdown)
      else if (plain) blocks.push(code(plain))
    }
  }
  return blocks.join('\n\n')
}
