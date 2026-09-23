export const RUNTIME_PROTOCOL_VERSION = 2
export const PAIRING_PROTOCOL_VERSION = 2
import { mutableStruct, mutableArray } from './schema.js'
import { minValue, urlSchema, refine, maxValue } from './schema.js'
import { Schema } from 'effect'
import { workspaceSchema, providerSchema, taskSchema } from './workspace.js'
import { pendingQuestionSchema } from './questions.js'
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
  protocolVersion: Schema.optional(Schema.Number.pipe(Schema.int())),
  runtimeHost: Schema.optional(Schema.String),
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
  autoContinueAfterRestart: Schema.optionalWith(Schema.Boolean, { default: () => false }),
})

export const runtimeRestartSchema = mutableStruct({ id: Schema.String })
