import { Schema } from 'effect'
import { maxValue, minValue, mutableArray, mutableStruct } from '../shared/schema.js'

/** Run a thread's harness, its commands and its terminals inside a local container. */
export const containerSandboxModeSchema = Schema.Literals(['off', 'mise'])
export const containerSandboxNetworkSchema = Schema.Literals(['full', 'none'])
export const containerSandboxSchema = mutableStruct({
  mode: containerSandboxModeSchema,
  /** Missing means full network access. */
  network: Schema.optional(containerSandboxNetworkSchema),
  /** Missing means no CPU limit. */
  cpus: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isFinite()),
      Schema.check(Schema.isBetween({ minimum: 0.25, maximum: 512 })),
    ),
  ),
  /** Missing means the default memory limit. */
  memoryMb: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 256, maximum: 4 * 1024 * 1024 })),
    ),
  ),
})
export type ContainerSandbox = Schema.Schema.Type<typeof containerSandboxSchema>
export type ContainerSandboxMode = Schema.Schema.Type<typeof containerSandboxModeSchema>

export const defaultContainerSandboxMemoryMb = 8192

export const containerSandboxNetworkWarning =
  'Without network access the harness cannot reach its model API unless that API runs inside the sandbox. Package installs and web requests also fail.'

export const containerSandboxEnabled = (value: ContainerSandbox | undefined) =>
  value?.mode === 'mise'

/** The thread's sandbox: its own snapshot, else the project default for a thread that has not
 * started yet. Started threads without a snapshot predate sandboxes and stay on the host. */
export function effectiveContainerSandbox(
  snapshot: ContainerSandbox | undefined,
  projectDefault: ContainerSandbox | undefined,
  started: boolean,
): ContainerSandbox | undefined {
  return snapshot ?? (started ? undefined : projectDefault)
}

export const containerSandboxThreadStateSchema = Schema.Literals([
  'preparing',
  'running',
  'stopped',
  'failed',
])
export const containerSandboxStatusSchema = mutableStruct({
  /** A container CLI answered and the runtime host can run sandboxes. */
  available: Schema.Boolean,
  cli: Schema.optional(Schema.Literals(['docker', 'podman'])),
  /** Setup guidance when unavailable. */
  message: Schema.optional(maxValue(Schema.String, 2000)),
  threads: mutableArray(
    mutableStruct({
      taskId: minValue(maxValue(Schema.String, 200), 1),
      state: containerSandboxThreadStateSchema,
      detail: Schema.optional(maxValue(Schema.String, 4000)),
      logPath: Schema.optional(maxValue(Schema.String, 4096)),
    }),
  ),
})
export type ContainerSandboxStatus = Schema.Schema.Type<typeof containerSandboxStatusSchema>
export type ContainerSandboxThreadStatus = ContainerSandboxStatus['threads'][number]

/** Per-harness sandbox support. A note explains a limit or a needed setup step. */
export const harnessSandboxSupportSchema = mutableStruct({
  supported: Schema.Boolean,
  note: Schema.optional(maxValue(Schema.String, 1000)),
})
export type HarnessSandboxSupport = Schema.Schema.Type<typeof harnessSandboxSupportSchema>

export function containerSandboxLabel(value: ContainerSandbox | undefined) {
  if (!containerSandboxEnabled(value)) return 'Off'
  return value?.network === 'none' ? 'Mise sandbox, no network' : 'Mise sandbox'
}
