import { maskFileMentions } from './file-mentions.js'
import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../../shared/schema.js'
import { insertPrompt } from './resource-mentions.js'

export const modelMentionSchema = mutableStruct({
  reference: Schema.String,
  name: Schema.String,
  provider: Schema.String,
  model: Schema.String,
})
export const modelMentionsSchema = mutableStruct({
  models: mutableArray(modelMentionSchema),
  unavailable: mutableArray(Schema.String),
})
export type ModelMention = typeof modelMentionSchema.Type

/** References use encoded segments so custom model IDs and ACP installations stay distinct. */
export function modelMentionReference(instance: string, model: string) {
  return `model:${encodeURIComponent(instance)}/${encodeURIComponent(model)}`
}

export function matchingModelMentions(models: readonly ModelMention[], query: string) {
  const words = query
    .trim()
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  if (query.trim().length < 2 || !words.length) return []
  return models
    .filter((model) => {
      const names = `${model.name} ${model.model} ${model.provider}`
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
      return words.every((word) => names.some((name) => name.startsWith(word)))
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.reference.localeCompare(b.reference))
    .slice(0, 12)
}

export function insertModelMention(text: string, start: number, caret: number, reference: string) {
  // Inline code keeps the exact model reference visible in sent messages and copied Markdown.
  return insertPrompt(text, start, caret, `\`${reference}\` `)
}

// Older rich composers saved the separator inside the closing backtick.
const modelMentionToken = /model:([^`\s/]{1,600})\/([^`\s]{1,1000}) */.source
const exactModelMention = new RegExp(`^${modelMentionToken}$`)
const inlineModelMentions = new RegExp('`' + modelMentionToken + '`', 'g')

function decodeModelMention(encodedHarness: string, encodedModel: string) {
  try {
    const harness = decodeURIComponent(encodedHarness)
    const model = decodeURIComponent(encodedModel)
    if (
      (harness + model).split('').some((character) => {
        const code = character.charCodeAt(0)
        return code < 32 || code === 127
      })
    )
      return
    return { harness, model }
  } catch {
    return
  }
}

export function parseModelMention(text: string) {
  const match = exactModelMention.exec(text)
  if (match) return decodeModelMention(match[1], match[2])
}

/** Decode only explicit inline references. Plain @ names remain normal prose. */
export function modelMentionContext(text: string) {
  const references = new Set<string>()
  for (const match of maskFileMentions(text).matchAll(inlineModelMentions)) {
    const reference = decodeModelMention(match[1], match[2])
    if (!reference) continue
    references.add(JSON.stringify(reference))
    if (references.size === 20) break
  }
  return references.size
    ? `User model references (these do not switch this thread’s model):\n${[...references].join('\n')}`
    : ''
}
