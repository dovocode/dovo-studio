import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../../shared/schema.js'

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
      state: Schema.Literals(['active', 'archived', 'missing']),
      dirty: Schema.Boolean,
      /** Git reports the folder is gone; removing only clears Git's record. */
      prunable: Schema.Boolean,
    }),
  ),
})
export type WorktreeList = Schema.Schema.Type<typeof worktreeListSchema>
/** Git worktrees selectable as an existing checkout for a new task. */
export const worktreeChoicesSchema = mutableStruct({
  worktrees: mutableArray(
    mutableStruct({ path: Schema.String, branch: Schema.String, dirty: Schema.Boolean }),
  ),
})
export type WorktreeChoices = Schema.Schema.Type<typeof worktreeChoicesSchema>
