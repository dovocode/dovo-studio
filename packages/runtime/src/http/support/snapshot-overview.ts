import type { Workspace } from '@dovo/protocol'

/** Fleet lists need task identity and state, not every conversation and file snapshot. */
export function overviewWorkspace(workspace: Workspace): Workspace {
  return {
    ...workspace,
    tasks: workspace.tasks.map((task) => ({
      ...task,
      messages: [],
      files: task.files.map(({ path, viewed }) => ({ path, viewed, before: '', after: '' })),
      draftAttachments: undefined,
      forkedFrom: task.forkedFrom ? { ...task.forkedFrom, snapshot: undefined } : undefined,
      turns: task.turns?.map((turn) => ({ ...turn, checkpoint: undefined })),
    })),
  }
}

/** Keep editable drafts and task metadata, but send history only for subscribed threads. */
export function scopedWorkspace(workspace: Workspace, taskIds: readonly string[]): Workspace {
  const details = new Set(taskIds)
  return {
    ...workspace,
    tasks: workspace.tasks.map((task) =>
      details.has(task.id)
        ? task
        : {
            ...task,
            messages: [],
            sideChats: task.sideChats?.map((chat) => ({ ...chat, messages: [] })),
            files: task.files.map(({ path, viewed }) => ({ path, viewed, before: '', after: '' })),
            forkedFrom: task.forkedFrom ? { ...task.forkedFrom, snapshot: undefined } : undefined,
            turns: task.turns?.map((turn) => ({ ...turn, checkpoint: undefined })),
          },
    ),
  }
}
