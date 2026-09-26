import { Schema } from 'effect'
import { mutableArray, mutableStruct } from './schema.js'

/** Dovo-created task worktrees on one computer (Settings → Coding → Worktrees). */
export const worktreeListSchema = mutableStruct({
  root: Schema.String,
  worktrees: mutableArray(
    mutableStruct({
      path: Schema.String,
      branch: Schema.String,
      repositoryId: Schema.String,
      repositoryName: Schema.String,
      taskId: Schema.optional(Schema.String),
      taskTitle: Schema.optional(Schema.String),
      /** active: its task is in use · archived: task archived · missing: task deleted */
      state: Schema.Literal('active', 'archived', 'missing'),
      dirty: Schema.Boolean,
      /** Git reports the folder is gone; removing only clears Git's record. */
      prunable: Schema.Boolean,
    }),
  ),
})
export type WorktreeList = Schema.Schema.Type<typeof worktreeListSchema>
