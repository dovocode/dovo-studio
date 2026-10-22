import { Schema } from 'effect'
import {
  forgeProviderSchema,
  forgeIdentityTokenSchema,
  maxValue,
  minValue,
  mutableStruct,
  pullActionSchema,
  pullCreateSchema,
  pullDetailSectionSchema,
  pullLineCommentSchema,
  pullSummarySchema,
  refine,
  urlSchema,
} from '@dovo/protocol'

const number = pullSummarySchema.fields.number
const pullOperationSchema = Schema.Union([
  mutableStruct({
    kind: Schema.Literal('list'),
    state: Schema.Literals(['open', 'closed', 'all']),
    page: number,
    background: Schema.Boolean,
  }),
  mutableStruct({ kind: Schema.Literals(['detail', 'feedback']), number }),
  mutableStruct({ kind: Schema.Literal('status'), number, background: Schema.Boolean }),
  mutableStruct({ kind: Schema.Literal('section'), number, section: pullDetailSectionSchema }),
  mutableStruct({ kind: Schema.Literal('nativeStack'), number, stackNumber: number }),
  mutableStruct({ kind: Schema.Literal('comment'), input: pullLineCommentSchema }),
  mutableStruct({ kind: Schema.Literal('create'), input: pullCreateSchema }),
  mutableStruct({ kind: Schema.Literal('act'), input: pullActionSchema }),
])
export type PullOperation = typeof pullOperationSchema.Type
const pullPeerScopeSchema = mutableStruct({
  provider: forgeProviderSchema,
  instance: refine(
    maxValue(urlSchema({ protocol: /^https?$/ }), 2048),
    (value) => {
      const url = new URL(value)
      return !url.username && !url.password && !url.search && !url.hash
    },
    'Use a source control server URL without credentials, query or fragment',
  ),
  repository: refine(
    maxValue(minValue(Schema.String, 1), 500),
    (value) =>
      value.split('/').length >= 2 &&
      value.split('/').every((part) => !!part.trim() && !['.', '..'].includes(part)) &&
      !/[\p{Cc}?#\\]/u.test(value),
    'Choose a source control repository',
  ),
  readerIdentity: forgeIdentityTokenSchema,
})
export type PullPeerScope = typeof pullPeerScopeSchema.Type
export const pullPeerRequestSchema = mutableStruct({
  owner: forgeIdentityTokenSchema,
  scope: pullPeerScopeSchema,
  operation: pullOperationSchema,
  fresh: Schema.optional(Schema.Boolean),
})
export const pullOperationWrites = (operation: PullOperation) =>
  ['act', 'comment', 'create'].includes(operation.kind)

export type PullCommunication = {
  servePull<T, I>(
    scope: PullPeerScope,
    operation: PullOperation,
    schema: Schema.Codec<T, I>,
    load: () => Promise<T>,
    fresh?: boolean,
  ): Promise<T>
  pull<T, I>(
    scope: PullPeerScope,
    operation: PullOperation,
    schema: Schema.Codec<T, I>,
    load: () => Promise<T>,
  ): Promise<T>
}
