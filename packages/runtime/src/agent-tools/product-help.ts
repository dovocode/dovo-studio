import { readFileSync, existsSync } from 'node:fs'
import { Schema } from 'effect'
import { decode, maxValue, minValue, strictStruct } from '@dovo/protocol'
import { HttpError } from '../errors.js'

export const helpDocuments = [
  'bots',
  'bot-learning-and-routines',
  'bot-voice-calls',
  'workflows',
  'orchestration',
  'usage',
  'security-and-pairing',
  'upstream-bot-adoptions',
] as const
const indexSchema = Schema.Struct({
  version: Schema.String,
  revision: Schema.String,
  documents: Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String })),
})
export const productHelpSchema = strictStruct({
  taskId: Schema.String,
  parentRunId: Schema.optional(Schema.String),
  action: Schema.Literals(['search', 'read']),
  query: Schema.optional(maxValue(minValue(Schema.String, 1), 300)),
  id: Schema.optional(maxValue(Schema.String, 200)),
  offset: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
    ),
  ),
})
let saved: typeof indexSchema.Type | undefined
function index() {
  if (saved) return saved
  const bundled = new URL('../help-docs/index.json', import.meta.url)
  if (existsSync(bundled))
    return (saved = decode(indexSchema, JSON.parse(readFileSync(bundled, 'utf8'))))
  return (saved = {
    version: 'development',
    revision: 'working-checkout',
    documents: helpDocuments.map((id) => ({
      id,
      text: readFileSync(new URL(`../../../../docs/${id}.md`, import.meta.url), 'utf8'),
    })),
  })
}

/** Reads only a build-time document allowlist. No user files, account data or network requests. */
export function productHelp(input: typeof productHelpSchema.Type) {
  const catalog = index()
  const sections = catalog.documents.flatMap((doc) =>
    doc.text
      .split(/(?=^#{1,3} )/m)
      .filter((text) => text.trim())
      .map((text, part) => ({
        id: `${doc.id}:${part}`,
        title: text.split('\n')[0].replace(/^#+\s*/, ''),
        text,
        source: `docs/${doc.id}.md`,
      })),
  )
  const base = { version: catalog.version, revision: catalog.revision }
  if (input.action === 'search') {
    const terms = [...new Set((input.query ?? '').toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])]
    if (!terms.length) throw new HttpError(400, 'Enter a help search query.')
    const hits = sections
      .map((section) => ({
        ...section,
        score: terms.reduce(
          (sum, term) =>
            sum +
            (section.title.toLowerCase().includes(term) ? 5 : 0) +
            (section.text.toLowerCase().includes(term) ? 1 : 0),
          0,
        ),
      }))
      .filter((section) => section.score > 0)
      .sort((a, b) => b.score - a.score)
    return {
      ...base,
      results: hits
        .slice(0, 5)
        .map(({ id, title, text, source }) => ({ id, title, source, excerpt: text.slice(0, 400) })),
    }
  }
  const section = sections.find((item) => item.id === input.id)
  if (!section)
    throw new HttpError(404, 'Help section not found. Search the installed documentation first.')
  const offset = input.offset ?? 0
  if (offset > section.text.length) throw new HttpError(400, 'Help offset is outside the section.')
  const end = Math.min(section.text.length, offset + 8000)
  return {
    ...base,
    ...section,
    text: section.text.slice(offset, end),
    nextOffset: end < section.text.length ? end : null,
  }
}
