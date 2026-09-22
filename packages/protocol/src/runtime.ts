import { z } from 'zod'
import { workspaceSchema, providerSchema } from './workspace.js'
import { pendingQuestionSchema } from './questions.js'
export const deviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
})
export const approvalSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  title: z.string(),
  detail: z.string(),
  createdAt: z.string(),
})
export const terminalSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  title: z.string(),
  exited: z.boolean(),
  exitCode: z.number().optional(),
})
export const jobRunStepSchema = z.object({
  nodeId: z.string(),
  label: z.string(),
  kind: z.enum(['trigger', 'task', 'review']),
  status: z.enum(['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled']),
  taskId: z.string().optional(),
  attempt: z.number().int().min(0),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
})
export const jobRunSchema = z.object({
  id: z.string(),
  automationId: z.string(),
  status: z.enum(['running', 'waiting', 'completed', 'failed', 'cancelled']),
  completedNodes: z.array(z.string()),
  taskIds: z.array(z.string()),
  waitingNodeId: z.string().optional(),
  currentNodeId: z.string().optional(),
  failedNodeId: z.string().optional(),
  steps: z.array(jobRunStepSchema).optional(),
  attempt: z.number().int().positive().optional(),
  interrupted: z.boolean().optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  finishedAt: z.string().optional(),
})
export const providerStatusSchema = z.object({
  provider: providerSchema,
  available: z.boolean(),
  detail: z.string(),
})
export const snapshotSchema = z.object({
  runtimeHost: z.string().optional(),
  revision: z.number(),
  workspace: workspaceSchema,
  approvals: z.array(approvalSchema),
  questions: z.array(pendingQuestionSchema).default([]),
  terminals: z.array(terminalSchema),
  runs: z.array(jobRunSchema),
  devices: z.array(deviceSchema),
  pendingDevices: z.array(z.object({ id: z.string(), name: z.string(), expiresAt: z.string() })),
  owner: z.boolean(),
})
export const connectionSchema = z.object({
  address: z.url({ protocol: /^https?$/ }).refine((value) => {
    try {
      const url = new URL(value)
      return !url.username && !url.password
    } catch {
      return false
    }
  }, 'Runtime address must not contain credentials'),
  token: z.string().min(20),
})
export const patchSchema = z.object({
  collection: z.enum(['agents', 'repositories', 'tasks', 'automations']),
  id: z.string(),
  changes: z.record(z.string(), z.object({ before: z.unknown(), after: z.unknown() })),
  create: z.unknown().optional(),
})
export const terminalInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().max(65536) }),
  z.object({
    type: z.literal('resize'),
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(1).max(300),
  }),
])
export type RuntimeConnection = z.infer<typeof connectionSchema>
export type RuntimeSnapshot = z.infer<typeof snapshotSchema>
export type WorkspacePatch = z.infer<typeof patchSchema>
export type Approval = z.infer<typeof approvalSchema>
export type TerminalInfo = z.infer<typeof terminalSchema>
export type JobRun = z.infer<typeof jobRunSchema>
export type JobRunStep = z.infer<typeof jobRunStepSchema>
export type ProviderStatus = z.infer<typeof providerStatusSchema>
export const responses = {
  ok: z.object({ ok: z.boolean() }),
  pairCode: z.object({ code: z.string(), expiresAt: z.string() }),
  pairRequest: z.object({ id: z.string(), secret: z.string(), expiresAt: z.string() }),
  pairClaim: z.object({
    status: z.enum(['pending', 'approved', 'denied']),
    token: z.string().optional(),
  }),
  ticket: z.object({ ticket: z.string() }),
  terminal: terminalSchema,
  provider: providerStatusSchema,
  files: z.object({ files: workspaceSchema.shape.tasks.element.shape.files }),
  inspected: z.object({ path: z.string(), branch: z.string() }),
  commit: z.object({ commit: z.string() }),
  pulls: z.object({
    pulls: z.array(
      z.object({
        number: z.number(),
        title: z.string(),
        url: z.string().url(),
        state: z.string(),
        headRefName: z.string(),
      }),
    ),
  }),
  job: z.object({ id: z.string() }),
  webhook: z.object({ secret: z.string(), path: z.string() }),
}
