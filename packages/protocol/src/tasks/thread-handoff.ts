import { Schema } from 'effect'
import { taskSchema, taskHarnessSchema } from '../workspace.js'
import { mutableStruct } from '../shared/schema.js'

export const continueHarnessSchema = mutableStruct({
  id: Schema.String,
  requestId: Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/)),
  harness: taskHarnessSchema,
  stop: Schema.Boolean,
})

/** An allowlist: native sessions, tool state, credentials and local paths never enter a handoff. */
export const portableThreadSchema = mutableStruct({
  sourceRuntimeId: Schema.String,
  sourceTaskId: Schema.String,
  title: taskSchema.fields.title,
  createdAt: taskSchema.fields.createdAt,
  messages: taskSchema.fields.messages,
  turns: taskSchema.fields.turns,
  nativeTodos: taskSchema.fields.nativeTodos,
  draft: taskSchema.fields.draft,
  draftPlan: taskSchema.fields.draftPlan,
  draftAttachments: taskSchema.fields.draftAttachments,
  permission: taskHarnessSchema.fields.permission,
  provider: taskHarnessSchema.fields.provider,
  approvalPolicy: taskHarnessSchema.fields.approvalPolicy,
  sandboxMode: taskHarnessSchema.fields.sandboxMode,
})
export type PortableThread = typeof portableThreadSchema.Type
