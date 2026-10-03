import { browserProfilesSchema, defaultBrowserProfiles } from '../previews/browser-profiles.js'
import { artifactRetentionSchema } from '../../conversation/artifacts.js'
export const RUNTIME_PROTOCOL_VERSION = 2
export const PAIRING_PROTOCOL_VERSION = 2
import { mutableStruct, mutableArray } from '../../shared/schema.js'
import { minValue, urlSchema, refine, maxValue } from '../../shared/schema.js'
import { Schema } from 'effect'
import { workspaceSchema, providerSchema, taskSchema } from '../../workspace.js'
import { runtimeDefaultsSchema } from './runtime-setup.js'
import { pendingQuestionSchema } from '../../conversation/workflow/questions.js'
import { acpInstallationSchema } from '../../auth/acp-registry.js'
export const deviceSchema = mutableStruct({
  id: Schema.String,
  name: Schema.String,
  createdAt: Schema.String,
  revokedAt: Schema.NullOr(Schema.String),
})
export const approvalSchema = mutableStruct({
  id: Schema.String,
  taskId: Schema.String,
  title: Schema.String,
  detail: Schema.String,
  createdAt: Schema.String,
})
export const terminalSchema = mutableStruct({
  checkoutId: Schema.optional(Schema.String),
  id: Schema.String,
  taskId: Schema.String,
  title: Schema.String,
  exited: Schema.Boolean,
  exitCode: Schema.optional(Schema.Number.pipe(Schema.finite())),
})
export const jobRunStepSchema = mutableStruct({
  nodeId: Schema.String,
  label: Schema.String,
  kind: Schema.Literal('trigger', 'task', 'review'),
  status: Schema.Literal('pending', 'running', 'waiting', 'completed', 'failed', 'cancelled'),
  taskId: Schema.optional(Schema.String),
  attempt: minValue(
    Schema.Number.pipe(Schema.finite()).pipe(
      Schema.int(),
      Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    ),
    0,
  ),
  startedAt: Schema.optional(Schema.String),
  finishedAt: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})
export const jobRunSchema = mutableStruct({
  id: Schema.String,
  automationId: Schema.String,
  status: Schema.Literal('running', 'waiting', 'completed', 'failed', 'cancelled'),
  completedNodes: mutableArray(Schema.String),
  taskIds: mutableArray(Schema.String),
  waitingNodeId: Schema.optional(Schema.String),
  currentNodeId: Schema.optional(Schema.String),
  failedNodeId: Schema.optional(Schema.String),
  steps: Schema.optional(mutableArray(jobRunStepSchema)),
  attempt: Schema.optional(
    Schema.Number.pipe(Schema.finite())
      .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
      .pipe(Schema.positive()),
  ),
  interrupted: Schema.optional(Schema.Boolean),
  error: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.optional(Schema.String),
  finishedAt: Schema.optional(Schema.String),
})
export const providerStatusSchema = mutableStruct({
  provider: providerSchema,
  available: Schema.Boolean,
  detail: Schema.String,
})
export const snapshotSchema = mutableStruct({
  artifactsEnabled: Schema.optional(Schema.Boolean),
  scopedAgentsSupported: Schema.optional(Schema.Boolean),
  settingsScopesSupported: Schema.optional(Schema.Boolean),
  /** Present on scoped replicas; only these threads contain authoritative history. */
  detailTaskIds: Schema.optional(mutableArray(Schema.String)),
  runtimeInstanceId: Schema.optional(Schema.String),
  protocolVersion: Schema.optional(Schema.Number.pipe(Schema.int())),
  runtimeHost: Schema.optional(Schema.String),
  releaseVersion: Schema.optional(Schema.String),
  releaseDistribution: Schema.optional(Schema.Literal('desktop', 'archive', 'source')),
  releaseCanUpdate: Schema.optional(Schema.Boolean),
  desktopApp: Schema.optional(
    mutableStruct({
      version: Schema.String,
      canUpdate: Schema.Boolean,
      channel: Schema.optional(Schema.Literal('stable', 'nightly')),
    }),
  ),
  defaults: Schema.optional(runtimeDefaultsSchema),
  acpInstallations: Schema.optionalWith(mutableArray(acpInstallationSchema), { default: () => [] }),
  revision: Schema.Number.pipe(Schema.finite()),
  workspace: workspaceSchema,
  approvals: mutableArray(approvalSchema),
  questions: Schema.optionalWith(mutableArray(pendingQuestionSchema), {
    default: () => [],
  }),
  terminals: mutableArray(terminalSchema),
  runs: mutableArray(jobRunSchema),
  devices: mutableArray(deviceSchema),
  pendingDevices: mutableArray(
    mutableStruct({
      id: Schema.String,
      name: Schema.String,
      expiresAt: Schema.String,
    }),
  ),
  owner: Schema.Boolean,
})
export const connectionSchema = mutableStruct({
  address: refine(
    urlSchema({
      protocol: /^https?$/,
    }),
    (value) => {
      try {
        const url = new URL(value)
        return !url.username && !url.password
      } catch {
        return false
      }
    },
    'Runtime address must not contain credentials',
  ),
  token: minValue(Schema.String, 20),
})
export const patchSchema = mutableStruct({
  collection: Schema.Literal('agents', 'repositories', 'tasks', 'automations'),
  id: Schema.String,
  changes: Schema.mutable(
    Schema.Record({
      key: Schema.String,
      value: mutableStruct({
        before: Schema.Unknown,
        after: Schema.Unknown,
      }),
    }),
  ),
  create: Schema.optional(Schema.Unknown),
})
export const terminalInputSchema = Schema.Union(
  ...[
    mutableStruct({
      type: Schema.Literal('ping'),
      nonce: maxValue(minValue(Schema.String, 1), 64),
    }),
    mutableStruct({
      type: Schema.Literal('input'),
      data: maxValue(Schema.String, 65536),
    }),
    mutableStruct({
      type: Schema.Literal('resize'),
      cols: maxValue(
        minValue(
          Schema.Number.pipe(Schema.finite()).pipe(
            Schema.int(),
            Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
          ),
          2,
        ),
        500,
      ),
      rows: maxValue(
        minValue(
          Schema.Number.pipe(Schema.finite()).pipe(
            Schema.int(),
            Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
          ),
          1,
        ),
        300,
      ),
    }),
  ],
)
export type RuntimeConnection = Schema.Schema.Type<typeof connectionSchema>
export type RuntimeSnapshot = Schema.Schema.Type<typeof snapshotSchema>
export type WorkspacePatch = Schema.Schema.Type<typeof patchSchema>
export type Approval = Schema.Schema.Type<typeof approvalSchema>
export type TerminalInfo = Schema.Schema.Type<typeof terminalSchema>
export type JobRun = Schema.Schema.Type<typeof jobRunSchema>
export type JobRunStep = Schema.Schema.Type<typeof jobRunStepSchema>
export type ProviderStatus = Schema.Schema.Type<typeof providerStatusSchema>
export const responses = {
  ok: mutableStruct({
    ok: Schema.Boolean,
  }),
  pairCode: mutableStruct({
    addresses: Schema.optional(
      mutableArray(mutableStruct({ name: Schema.String, address: Schema.String })),
    ),
    code: Schema.String,
    expiresAt: Schema.String,
  }),
  pairRequest: mutableStruct({
    protocolVersion: Schema.Literal(PAIRING_PROTOCOL_VERSION),
    id: Schema.String,
    secret: Schema.String,
    expiresAt: Schema.String,
  }),
  pairClaim: mutableStruct({
    status: Schema.Literal('pending', 'approved', 'denied'),
    token: Schema.optional(Schema.String),
  }),
  ticket: mutableStruct({
    ticket: Schema.String,
  }),
  terminal: terminalSchema,
  provider: providerStatusSchema,
  files: mutableStruct({
    files: taskSchema.fields.files,
  }),
  branchDiff: mutableStruct({
    files: taskSchema.fields.files,
    omitted: mutableArray(Schema.String),
    base: Schema.String,
  }),
  projectFileList: mutableStruct({ files: mutableArray(Schema.String) }),
  projectFile: mutableStruct({ path: Schema.String, contents: Schema.String }),
  gitActionState: mutableStruct({
    dirty: Schema.Boolean,
    branch: Schema.String,
    ahead: Schema.Number,
    behind: Schema.Number,
    tracking: Schema.Boolean,
    canPush: Schema.Boolean,
  }),
  inspected: mutableStruct({
    path: Schema.String,
    branch: Schema.String,
  }),
  commit: mutableStruct({
    commit: Schema.String,
  }),
  pulls: mutableStruct({
    pulls: mutableArray(
      mutableStruct({
        number: Schema.Number.pipe(Schema.finite()),
        title: Schema.String,
        url: Schema.String.pipe(Schema.compose(urlSchema())),
        state: Schema.String,
        headRefName: Schema.String,
      }),
    ),
  }),
  job: mutableStruct({
    id: Schema.String,
  }),
  webhook: mutableStruct({
    secret: Schema.String,
    path: Schema.String,
  }),
}

export const runtimePreferencesSchema = mutableStruct({
  settledArtifactRetention: Schema.optionalWith(artifactRetentionSchema, {
    default: () => 'forever' as const,
  }),
  archivedArtifactRetention: Schema.optionalWith(artifactRetentionSchema, {
    default: () => 'forever' as const,
  }),
  enableArtifacts: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  browserProfiles: Schema.optionalWith(browserProfilesSchema, { default: defaultBrowserProfiles }),
  autoContinueAfterRestart: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  /** Archive tasks with no activity for this many days; 0 turns it off. */
  autoArchiveDays: Schema.optionalWith(Schema.Literal(0, 7, 14, 30), { default: () => 0 as const }),
  /** macOS: keep the computer awake while any task is running. */
  preventSleepWhileRunning: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  /** Archive a task once its pull request is merged or closed (idle tasks only). */
  archiveOnPullMerge: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  /** Settle (without archiving) idle threads once their main PR is merged or closed. */
  settleOnPullClose: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  /** Verify and attach PRs mentioned in messages or matching the task branch. */
  autoLinkPullRequests: Schema.optionalWith(Schema.Boolean, { default: () => true }),
  /** Housekeeping removes clean worktrees of archived tasks; branches are always kept. */
  removeArchivedWorktrees: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  /** Delete activity history older than this many days; 0 keeps everything. Defaults to 90 so
   * request and tool history cannot grow the database without bound. */
  activityRetentionDays: Schema.optionalWith(Schema.Literal(0, 30, 90, 365), {
    default: () => 90 as const,
  }),
  /** Prefix for new task branches, e.g. `dovo/` or `feature/`; empty for none. */
  branchPrefix: Schema.optionalWith(
    Schema.String.pipe(
      Schema.maxLength(40),
      Schema.pattern(/^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*$/, {
        message: () => 'Use letters, numbers, dots, dashes or underscores, ending with /',
      }),
      // Git also rejects `..` and components ending in `.lock` or `.`.
      Schema.filter((prefix) => !/\.\.|\.lock\/|\.\//.test(prefix), {
        message: () => 'Git branch names cannot contain .. or end a part with .lock or .',
      }),
    ),
    { default: () => 'dovo/' },
  ),
})

export const runtimeRestartSchema = mutableStruct({ id: Schema.String })

/** Tidies a typed branch prefix (`feature` → `feature/`) and reports whether Git accepts it. */
export function normalizeBranchPrefix(input: string) {
  const trimmed = input.trim()
  const prefix = trimmed && !trimmed.endsWith('/') ? `${trimmed}/` : trimmed
  const valid = Schema.decodeUnknownEither(runtimePreferencesSchema)({ branchPrefix: prefix })
  return { prefix, valid: valid._tag === 'Right' }
}
