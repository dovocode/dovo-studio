import { expect, test } from 'vite-plus/test'
import type { Node } from 'prosemirror-model'
import {
  parseRichMarkdown,
  positionAtSourceOffset,
  richSchema,
  serializeRichMarkdown,
  sourceOffsetAt,
} from './rich-markdown'

const parse = (text: string) => {
  const result = parseRichMarkdown(text)
  if (!result.supported) throw new Error(result.reason)
  return result.value
}
const paragraph = (text: string) =>
  richSchema.node('paragraph', null, text ? [richSchema.text(text)] : [])
const replaceBlock = (doc: Node, index: number, block: Node) => {
  return doc.copy(doc.content.replaceChild(index, block))
}

test('opening a draft never changes its Markdown', () => {
  for (const text of [
    '',
    'Fix `src/__tests__/a_b.ts` and *keep* 2 * 3 as is\nsecond line',
    '#  Title\n\n\n- one\n- two\n\n1) first\n2) second\n\n> quote\n\n~~~ts\nconst a = 1\n~~~\n',
    '___\n\nSee <https://example.com/_next/> and https://example.com/a_b_c',
    '\n\nleading blank lines and **bold** trailing  \n',
  ]) {
    const value = parse(text)
    expect(value.text).toBe(text)
    expect(serializeRichMarkdown(value.doc, value).text).toBe(text)
  }
})

test('editing one block keeps every other block and separator byte-for-byte', () => {
  const text = '# Plan\n\n\n- [ ] keep *this*  \n- [ ] and_this\n\nchange me\n\n___\n'
  const value = parse(text)
  const doc = replaceBlock(value.doc, 2, paragraph('changed paragraph'))
  expect(serializeRichMarkdown(doc, value).text).toBe(
    '# Plan\n\n\n- [ ] keep *this*  \n- [ ] and_this\n\nchanged paragraph\n\n___\n',
  )
})

test('edited text uses literal characters unless escaping is needed to keep the meaning', () => {
  const value = parse('placeholder')
  const edit = (text: string) =>
    serializeRichMarkdown(replaceBlock(value.doc, 0, paragraph(text)), value).text
  expect(edit('@src/tests/my_file.ts uses 2 * 3')).toBe('@src/tests/my_file.ts uses 2 * 3')
  // Literal `__tests__` would render as strong emphasis, so it is escaped to keep what was typed.
  expect(edit('@src/__tests__/a.ts').match(/\\/g)).toHaveLength(1)
  expect(parse(edit('@src/__tests__/a.ts')).doc.textContent).toBe('@src/__tests__/a.ts')
  expect(parse(edit('*not emphasis*')).doc.textContent).toBe('*not emphasis*')
  expect(edit('2 * 3 and a_b and - x')).toBe('2 * 3 and a_b and - x')
  expect(edit('# not a heading')).toBe('\\# not a heading')
  expect(edit('')).toBe('')
})

test('a line that would start a list after a line break gets one escape', () => {
  const value = parse('placeholder')
  const block = richSchema.node('paragraph', null, [
    richSchema.text('Hello '),
    richSchema.text(' bold', [richSchema.mark('strong')]),
    richSchema.node('hard_break'),
    richSchema.text('- not a list and 2 * 3'),
  ])
  expect(serializeRichMarkdown(replaceBlock(value.doc, 0, block), value).text).toBe(
    'Hello  **bold**\n\\- not a list and 2 * 3',
  )
})

test('line breaks serialize as plain newlines and marks round-trip', () => {
  const value = parse('placeholder')
  const block = richSchema.node('paragraph', null, [
    richSchema.text('first'),
    richSchema.node('hard_break'),
    richSchema.text('bold', [richSchema.mark('strong')]),
    richSchema.text(' and '),
    richSchema.text('gone', [richSchema.mark('strike')]),
    richSchema.text(' '),
    richSchema.text('a_b', [richSchema.mark('code')]),
  ])
  const text = serializeRichMarkdown(replaceBlock(value.doc, 0, block), value).text
  expect(text).toBe('first\n**bold** and ~~gone~~ `a_b`')
  expect(parse(text).doc.child(0).eq(block)).toBe(true)
})

test('Markdown outside the rich schema stays in source mode', () => {
  for (const text of [
    '| a | b |\n| - | - |\n| 1 | 2 |',
    '![diagram](https://example.com/a.png)',
    'Read [the docs][docs].\n\n[docs]: https://example.com',
    'windows\r\nline endings',
  ])
    expect(parseRichMarkdown(text).supported).toBe(false)
  expect(parseRichMarkdown('<b>literal html</b> stays text').supported).toBe(true)
})

test('any literal text typed in rich mode reads back as that text', () => {
  const value = parse('placeholder')
  const alphabet = 'ab_*`~[]()<>#!-+=.1 |\\&;:/@$'
  let seed = 7
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  for (let run = 0; run < 2000; run++) {
    const length = 1 + Math.floor(random() * 14)
    const text = Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)])
      .join('')
      .trim()
    if (!text) continue
    const markdown = serializeRichMarkdown(replaceBlock(value.doc, 0, paragraph(text)), value).text
    const reread = parse(markdown).doc
    expect({ text, markdown, read: reread.textContent, blocks: reread.childCount }).toEqual({
      text,
      markdown,
      read: text,
      blocks: 1,
    })
  }
})

test('caret positions map between rich text and Markdown source', () => {
  const markdown = '# Plan\n\nKeep **bold** words\n\n- first\n- second'
  const { doc } = parse(markdown)
  for (const [offset, label] of [
    [2, 'start of heading text'],
    [8, 'start of paragraph'],
    [17, 'inside bold'],
    [markdown.indexOf('second') + 3, 'inside list item'],
    [markdown.length, 'end'],
  ] as const) {
    const position = positionAtSourceOffset(doc, markdown, offset)
    expect([label, sourceOffsetAt(doc, markdown, position)]).toEqual([label, offset])
  }
  expect(doc.textBetween(0, positionAtSourceOffset(doc, markdown, 17))).toContain('Keep bo')
})
