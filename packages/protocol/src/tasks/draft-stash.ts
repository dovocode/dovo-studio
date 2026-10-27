import { Schema } from 'effect'
import { decode, maxValue, minValue, mutableStruct } from '../shared/schema.js'

export const MAX_STASHED_DRAFTS = 20
export const MAX_STASHED_DRAFT_LENGTH = 100_000
const entrySchema = mutableStruct({
  id: maxValue(minValue(Schema.String, 1), 200),
  text: maxValue(minValue(Schema.String, 1), MAX_STASHED_DRAFT_LENGTH),
  createdAt: Schema.Number.pipe(Schema.check(Schema.isFinite())),
})
export type StashedDraft = Schema.Schema.Type<typeof entrySchema>

/** Each draft has its own key so unrelated window writes cannot replace the whole collection. */
export function draftStashScope(runtimeId: string, taskId: string) {
  return `dovo.draft-stash.${encodeURIComponent(JSON.stringify([runtimeId, taskId]))}.`
}

export function restoreStashedText(current: string, saved: string) {
  return current.trim() ? `${current}\n\n${saved}` : saved
}

export function createDraftStash(storage: {
  getAllKeys: () => Promise<readonly string[]>
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}) {
  const keys = async (scope: string) =>
    (await storage.getAllKeys()).filter((key) => key.startsWith(scope))
  return {
    async list(scope: string): Promise<StashedDraft[]> {
      const entries = await Promise.all(
        (await keys(scope)).map(async (key) => {
          const raw = await storage.getItem(key)
          // A different window may remove an entry between enumeration and reading.
          if (raw === null) return []
          const entry = decode(entrySchema, JSON.parse(raw))
          if (key !== scope + encodeURIComponent(entry.id))
            throw new Error('A saved draft has an invalid identity.')
          return [entry]
        }),
      )
      return entries.flat().sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    },
    async save(scope: string, value: StashedDraft) {
      if (value.text.length > MAX_STASHED_DRAFT_LENGTH)
        throw new Error('Keep stashed drafts to 100,000 characters or fewer.')
      const entry = decode(entrySchema, value)
      if (!entry.text.trim()) throw new Error('Write a prompt before stashing it.')
      if ((await keys(scope)).length >= MAX_STASHED_DRAFTS)
        throw new Error(
          `Keep up to ${MAX_STASHED_DRAFTS} stashed drafts per thread. Delete one first.`,
        )
      const key = scope + encodeURIComponent(entry.id)
      if ((await storage.getItem(key)) !== null) throw new Error('This saved draft already exists.')
      await storage.setItem(key, JSON.stringify(entry))
    },
    async remove(scope: string, id: string) {
      await storage.removeItem(scope + encodeURIComponent(id))
    },
  }
}
