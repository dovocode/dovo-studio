import { Schema } from 'effect'
import { maxValue, minValue, mutableArray, mutableStruct } from '../../shared/schema.js'
import { deviceHostSchema } from '../../runtime/previews/device-hosts.js'
import type { RuntimeProfile, RuntimeOverview } from '../../runtime/connection/runtime-fleet.js'

const text = (max = 200) => maxValue(minValue(Schema.String, 1), max)
const integer = Schema.Number.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
)
export const projectTransferSshSchema = mutableStruct({
  sshHost: deviceHostSchema.fields.sshHost,
  sshUser: deviceHostSchema.fields.sshUser,
  sshPort: deviceHostSchema.fields.sshPort,
  identityFile: deviceHostSchema.fields.identityFile,
  runtimePort: deviceHostSchema.fields.sshPort,
})
const transferThreadSchema = mutableStruct({
  title: text(200),
  prompt: maxValue(Schema.String, 100000),
})
export const projectTransferSourceSchema = mutableStruct({
  repositoryId: text(),
  worktreePath: Schema.optional(text(4096)),
})
export const projectTransferDestinationSchema = Schema.Union([
  mutableStruct({ repositoryId: text() }),
  mutableStruct({ parentDirectory: text(4096) }),
])
export const projectTransferPlanInputSchema = mutableStruct({
  ...projectTransferSourceSchema.fields,
  targetId: text(),
  ssh: Schema.optional(projectTransferSshSchema),
})
export const projectTransferProjectSchema = mutableStruct({
  identity: Schema.optional(text(4096)),
  rootCommit: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{40,64}$/))),
})
export const projectTransferPlanSchema = mutableStruct({
  repositories: mutableArray(mutableStruct({ id: text(), name: text(), path: text(4096) })),
  worktreesRoot: text(4096),
})
export const projectTransferStartSchema = mutableStruct({
  id: text(80),
  ...projectTransferSourceSchema.fields,
  thread: Schema.optional(transferThreadSchema),
  targetId: text(),
  ignoredFiles: maxValue(mutableArray(text(4096)), 10000),
  ssh: Schema.optional(projectTransferSshSchema),
  destination: Schema.optional(projectTransferDestinationSchema),
})
export type ProjectTransferStart = typeof projectTransferStartSchema.Type
export const projectTransferInspectionSchema = mutableStruct({
  files: integer,
  bytes: integer,
  skippedLinks: integer,
  ignoredFiles: mutableArray(mutableStruct({ path: text(4096), bytes: integer })),
  ignoredFilesTruncated: Schema.optional(Schema.Boolean),
})
export const projectTransferSchema = mutableStruct({
  id: Schema.String,
  repositoryId: Schema.String,
  targetId: Schema.String,
  targetName: Schema.String,
  transport: Schema.Literals(['p2p', 'ssh']),
  state: Schema.Literals([
    'preparing',
    'copying',
    'registering',
    'completed',
    'failed',
    'cancelled',
  ]),
  bytes: integer,
  totalBytes: integer,
  updatedAt: integer,
  error: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  targetRepositoryId: Schema.optional(Schema.String),
  targetTaskId: Schema.optional(Schema.String),
  threadStartError: Schema.optional(Schema.String),
  worktreePath: Schema.optional(Schema.String),
  skippedLinks: Schema.optional(integer),
})
export type ProjectTransfer = typeof projectTransferSchema.Type
export const projectTransferTargetsSchema = mutableArray(
  mutableStruct({ id: text(), name: text() }),
)
export const projectTransferEntrySchema = mutableStruct({
  path: text(4096),
  kind: Schema.Literals(['file', 'bundle', 'index']),
  bytes: integer,
  sha256: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  mode: maxValue(integer, 0o777),
})
export const projectTransferManifestSchema = mutableStruct({
  id: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9-]{36}$/))),
  runtimeId: text(),
  name: text(),
  entries: maxValue(mutableArray(projectTransferEntrySchema), 100000),
  thread: Schema.optional(transferThreadSchema),
  worktree: Schema.optional(
    mutableStruct({
      ...projectTransferProjectSchema.fields,
      baseHead: projectTransferProjectSchema.fields.rootCommit,
      baseBranch: Schema.optional(text(4096)),
      destination: projectTransferDestinationSchema,
    }),
  ),
  git: Schema.optional(
    mutableStruct({
      head: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{40,64}$/))),
      branch: Schema.optional(text(4096)),
      remote: Schema.optional(text(4096)),
    }),
  ),
})
export type ProjectTransferManifest = typeof projectTransferManifestSchema.Type
export const projectTransferChunkSchema = mutableStruct({
  id: Schema.String,
  index: integer,
  offset: integer,
  data: maxValue(
    Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z0-9+/]*={0,2}$/))),
    350000,
  ),
})
/** Keep batches below the existing request limit, including base64 and metadata. */
export const projectTransferBatchSchema = mutableStruct({
  id: Schema.String,
  chunks: mutableArray(
    mutableStruct({
      index: integer,
      offset: integer,
      data: projectTransferChunkSchema.fields.data,
    }),
  ).pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(128)),
    Schema.check(
      Schema.makeFilter(
        (chunks) => chunks.reduce((sum, chunk) => sum + chunk.data.length, 0) <= 350000,
      ),
    ),
  ),
})
export const projectTransferResultSchema = mutableStruct({
  taskId: Schema.optional(Schema.String),
  threadStartError: Schema.optional(Schema.String),
  repositoryId: Schema.String,
  path: Schema.String,
})
export const projectTransferActive = (job: ProjectTransfer) =>
  ['preparing', 'copying', 'registering'].includes(job.state)
export function projectTransferLabel(job: ProjectTransfer) {
  if (job.state === 'failed') return job.error || 'Copy failed. Try again.'
  if (job.state === 'cancelled') return 'Copy cancelled'
  if (job.state === 'completed') return `Added to ${job.targetName}`
  if (job.state === 'preparing') return 'Preparing workspace…'
  if (job.state === 'registering') return 'Setting up project…'
  return `Copying to ${job.targetName} · ${job.totalBytes ? Math.floor((job.bytes / job.totalBytes) * 100) : 0}%`
}
/** Use stable machine identities, including the built-in desktop computer's local profile. */
export function projectTransferPeers(
  profiles: readonly RuntimeProfile[],
  overviews: readonly RuntimeOverview[],
  sourceId?: string,
) {
  const peers = profiles.flatMap((profile) => {
    const runtimeId =
      profile.connection.runtimeId ??
      overviews.find((entry) => entry.profile.id === profile.id)?.snapshot?.runtimeId
    return !runtimeId || runtimeId === sourceId
      ? []
      : [
          {
            id: profile.id === 'local' ? runtimeId : profile.id,
            name: profile.name,
            connection: { ...profile.connection, runtimeId },
          },
        ]
  })
  return [...new Map(peers.map((peer) => [peer.connection.runtimeId, peer])).values()]
}
