import { Schema } from 'effect'
import { decode, mutableArray, mutableStruct } from '@dovo/protocol'
import jsonPatch from 'fast-json-patch'

export const vibeInitialize = {
  clientInfo: { name: 'dovo_studio', version: '0.1.0' },
  capabilities: { callbackKinds: ['approval', 'user_input'] },
}
export const vibeServerInfo = mutableStruct({
  serverInfo: mutableStruct({ name: Schema.String, version: Schema.String }),
})
export const vibeConfig = mutableStruct({
  config: mutableStruct({
    activeModel: mutableStruct({ alias: Schema.String }),
    models: mutableArray(
      mutableStruct({
        alias: Schema.String,
        displayName: Schema.String,
        thinking: Schema.String,
        thinkingLevels: Schema.optional(mutableArray(Schema.String)),
      }),
    ),
  }),
})
const operation = mutableStruct({
  op: Schema.Literals(['add', 'remove', 'replace', 'append']),
  path: Schema.String,
  value: Schema.optional(Schema.Unknown),
})
/** Vibe extends JSON Patch with string append; all other operations use RFC 6902. */
export function patchVibeEntry(entry: Record<string, unknown>, raw: unknown) {
  let result = structuredClone(entry)
  for (const patch of decode(mutableArray(operation), raw)) {
    if (patch.op === 'append') {
      const previous: unknown = jsonPatch.getValueByPointer(result, patch.path)
      if (typeof previous !== 'string' || typeof patch.value !== 'string')
        throw new Error('Vibe sent an invalid string append')
      result = jsonPatch.applyPatch(
        result,
        [{ op: 'replace', path: patch.path, value: previous + patch.value }],
        true,
      ).newDocument
    } else if (patch.op === 'remove') {
      result = jsonPatch.applyPatch(result, [{ op: 'remove', path: patch.path }], true).newDocument
    } else {
      result = jsonPatch.applyPatch(
        result,
        [{ op: patch.op, path: patch.path, value: patch.value }],
        true,
      ).newDocument
    }
  }
  return result
}
