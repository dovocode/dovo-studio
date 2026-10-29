import { applyEdits, format, visit } from 'jsonc-parser'

/** Validate without reserializing: IDs, exponents, duplicate keys and escapes stay intact. */
export function formatBrowserJson(source: string) {
  JSON.parse(source)
  return applyEdits(
    source,
    format(source, undefined, { insertSpaces: true, tabSize: 2, eol: '\n' }),
  )
}

const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** CSP-safe lexical markup for filtered results; no WASM or generated code in the page. */
export function highlightFilteredBrowserJson(source: string) {
  if (source.length > 512 * 1024) return escape(source)
  let html = ''
  let position = 0
  const token = (category: string, offset: number, length: number) => {
    html += escape(source.slice(position, offset))
    html += `<span class="dovo-json-${category}">${escape(source.slice(offset, offset + length))}</span>`
    position = offset + length
  }
  visit(source, {
    onObjectProperty: (_property, offset, length) => token('property', offset, length),
    onLiteralValue: (value: unknown, offset, length) =>
      token(
        typeof value === 'string'
          ? 'string'
          : typeof value === 'number'
            ? 'number'
            : typeof value === 'boolean'
              ? 'boolean'
              : 'constant',
        offset,
        length,
      ),
  })
  return html + escape(source.slice(position))
}
