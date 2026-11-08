import { randomUUID } from '../random-uuid.js'
import type { Task } from '../workspace.js'

/** Carry the composer's configuration into another thread, without carrying its work. */
export function nextThreadDraft(task: Task, id = randomUUID()): Task {
  return {
    id,
    title: 'New thread',
    repositoryId: task.repositoryId,
    autoProject: task.autoProject,
    autoProjectExecution: task.autoProjectExecution,
    agentId: task.agentId,
    agentName: task.agentName,
    agentIcon: task.agentIcon,
    harness: task.harness,
    harnessCustomized: task.harnessCustomized,
    agentOverrides: task.agentOverrides,
    modelSelection: task.modelSelection,
    modelSelectionDifficulty: task.modelSelectionDifficulty,
    draftTurnSettings: task.draftTurnSettings,
    draftPlan: task.draftPlan,
    execution: task.execution,
    existingWorktreePath: task.existingWorktreePath,
    worktreeBaseBranch: task.worktreeBaseBranch,
    worktreeFromOrigin: task.worktreeFromOrigin,
    worktreeIncludeChanges: task.worktreeIncludeChanges,
    setupCommand: task.setupCommand,
    submodules: task.submodules,
    linkedCheckouts: task.linkedCheckouts?.map((link) => ({ ...link })),
    settleBehavior: task.settleBehavior,
    archiveAfterSettledDays: task.archiveAfterSettledDays,
    status: 'draft',
    createdAt: new Date().toISOString(),
    messages: [],
    files: [],
    draft: '',
    example: false,
  }
}
