import { Schema } from 'effect'
import { artifactSchema } from '../conversation/artifacts.js'
import { attachmentReadSchema } from '../shared/attachments.js'
import { mutableStruct, mutableArray, minValue, maxValue, uuidSchema } from '../shared/schema.js'
import { taskSchema, providerSchema } from '../workspace.js'

export * from './transfer-state.js'
export const TRANSFER_MAX_BYTES = 64 * 1024 * 1024
const id = maxValue(minValue(Schema.String, 1), 200)
const hash = Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))
export const transferModeSchema = Schema.Literal('native', 'replay')
export const transferTargetSchema = mutableStruct({
  runtimeId: uuidSchema,
  address: maxValue(minValue(Schema.String, 1), 4096),
  repositoryId: id,
  agentId: id,
  taskId: uuidSchema,
})
export const transferPrepareSchema = mutableStruct({
  id: uuidSchema,
  taskId: id,
  sourceAddress: maxValue(minValue(Schema.String, 1), 4096),
  target: transferTargetSchema,
  mode: transferModeSchema,
})
export const transferOptionsSchema = mutableStruct({
  runtimeId: uuidSchema,
  projects: mutableArray(
    mutableStruct({
      id,
      name: Schema.String,
      identity: Schema.String,
      agents: mutableArray(
        mutableStruct({ id, name: Schema.String, provider: providerSchema, model: Schema.String }),
      ),
    }),
  ),
})
export const nativeSessionSchema = mutableStruct({
  provider: Schema.Literal('codex', 'claude'),
  version: maxValue(Schema.String, 200),
  sessionId: uuidSchema,
  files: maxValue(
    mutableArray(
      mutableStruct({
        path: maxValue(minValue(Schema.String, 1), 4096),
        data: maxValue(Schema.String, TRANSFER_MAX_BYTES),
        hash,
      }),
    ),
    1000,
  ),
})
export const transferPackageSchema = mutableStruct({
  version: Schema.Literal(1),
  id: uuidSchema,
  sourceRuntimeId: uuidSchema,
  sourceAddress: Schema.String,
  sourceDirectory: Schema.String,
  target: transferTargetSchema,
  mode: transferModeSchema,
  identity: Schema.String,
  head: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{40,64}$/)),
  provider: providerSchema,
  model: Schema.String,
  task: taskSchema.pick(
    'id',
    'title',
    'repositoryId',
    'agentId',
    'status',
    'createdAt',
    'messages',
    'files',
    'draft',
    'draftAttachments',
    'example',
    'turns',
    'sessionId',
    'consumedMessageIds',
    'compactions',
    'sideChats',
    'budget',
  ),
  attachments: mutableArray(attachmentReadSchema),
  artifacts: mutableArray(artifactSchema),
  native: Schema.optional(nativeSessionSchema),
  activationHash: hash,
  cancellationHash: hash,
})
export const transferEnvelopeSchema = mutableStruct({
  package: transferPackageSchema,
  checksum: hash,
})
export const transferReceiptSchema = mutableStruct({
  id: uuidSchema,
  checksum: hash,
  taskId: uuidSchema,
})
export const transferProofSchema = mutableStruct({
  ...transferReceiptSchema.fields,
  secret: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
})
export const transferIdSchema = mutableStruct({ id: uuidSchema })
export const transferAbortSourceSchema = mutableStruct({ id: uuidSchema, taskId: id })
export const transferStatusSchema = mutableStruct({
  id: uuidSchema,
  state: Schema.Literal(
    'preparing',
    'prepared',
    'staged',
    'aborting',
    'sealed',
    'active',
    'aborted',
  ),
  checksum: Schema.optional(hash),
  taskId: id,
})
export type TransferPackage = typeof transferPackageSchema.Type
export type NativeSession = typeof nativeSessionSchema.Type
export type TransferPrepare = typeof transferPrepareSchema.Type

type TransferCall = <S extends Schema.Schema.AnyNoContext>(
  path: string,
  input: unknown,
  schema: S,
) => Promise<Schema.Schema.Type<S>>
/** Server state is authoritative; callers may repeat this after a lost response or client restart. */
export async function moveTaskToComputer(
  source: TransferCall,
  destination: TransferCall,
  input: TransferPrepare,
) {
  const envelope = await source('/api/tasks/transfer/prepare', input, transferEnvelopeSchema)
  const receipt = await destination('/api/tasks/transfer/stage', envelope, transferReceiptSchema)
  const proof = await source('/api/tasks/transfer/seal', receipt, transferProofSchema)
  await destination('/api/tasks/transfer/activate', proof, transferStatusSchema)
  return { id: receipt.taskId }
}
export async function abortTaskTransfer(
  source: TransferCall,
  destination: TransferCall,
  input: TransferPrepare,
) {
  const proof = await source('/api/tasks/transfer/begin-abort', input, transferProofSchema)
  await destination('/api/tasks/transfer/abort', proof, transferStatusSchema)
  return source(
    '/api/tasks/transfer/abort-source',
    { id: input.id, taskId: input.taskId },
    transferStatusSchema,
  )
}
