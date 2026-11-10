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

/** Decode only explicit inline references. Plain @ names remain normal prose. */
export function modelMentionContext(text: string) {
  const references = new Map<string, { harness: string; model: string }>()
  for (const match of text.matchAll(/`model:([^`\s/]{1,600})\/([^`\s]{1,1000})`/g)) {
    try {
      const harness = decodeURIComponent(match[1]),
        model = decodeURIComponent(match[2])
      if (
        !harness ||
        !model ||
        (harness + model).split('').some((character) => character.charCodeAt(0) < 32)
      )
        continue
      references.set(match[0], { harness, model })
      if (references.size === 20) break
    } catch {
      /* A malformed user reference stays visible as ordinary message text. */
    }
  }
  return references.size
    ? `User model references (these do not switch this thread’s model):\n${[...references.values()].map((reference) => JSON.stringify(reference)).join('\n')}`
    : ''
}
