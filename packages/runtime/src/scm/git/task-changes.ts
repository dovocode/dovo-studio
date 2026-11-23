import type { WorkspaceStore } from '../../storage/workspace.js'
import type { GitService } from './git.js'
import { retainChangedFiles } from './retain-changes.js'

const pending = new WeakMap<WorkspaceStore, Map<string, symbol>>()

export async function loadSelectedTaskChange(
  store: WorkspaceStore,
  git: GitService,
  id: string,
  cwd: string,
  path: string,
) {
  const task = store.taskSummary(id)
  const file = task.files.find((item) => item.path === path)
  if (file?.preview?.kind !== 'deferred') return
  const preview = await git.selectedWorkingChange(cwd, file)
  if (!preview) return
  store.updateTask(id, (current) => {
    if (
      current.repositoryId !== task.repositoryId ||
      current.checkoutBranch !== task.checkoutBranch ||
      current.existingWorktreePath !== task.existingWorktreePath ||
      !current.files.some(
        (item) =>
          item.path === path &&
          item.workingRevision === file.workingRevision &&
          item.preview?.kind === 'deferred',
      )
    )
      return current
    return {
      ...current,
      files: current.files.map((item) =>
        item.path === path
          ? {
              ...preview,
              gitStatus: item.gitStatus,
              viewed: item.viewed,
              changedSinceViewed: item.changedSinceViewed,
            }
          : item,
      ),
    }
  })
}

/** Publish only the latest requested scan for this task. */
export async function refreshTaskChanges(
  store: WorkspaceStore,
  git: GitService,
  id: string,
  cwd: string,
  loadPreviews = true,
) {
  let scans = pending.get(store)
  if (!scans) pending.set(store, (scans = new Map()))
  const scan = Symbol()
  scans.set(id, scan)
  const before = store.taskSummary(id)
  try {
    // Give saved inline previews from earlier runtimes a revision before switching to metadata.
    const previews = loadPreviews || before.files.some((file) => !file.workingRevision)
    const incoming = await git.changes(cwd, previews)
    const current = store.taskSummary(id)
    if (
      scans.get(id) !== scan ||
      before.repositoryId !== current.repositoryId ||
      before.checkoutBranch !== current.checkoutBranch ||
      before.existingWorktreePath !== current.existingWorktreePath
    )
      return current.files
    const files = retainChangedFiles(current.files, incoming, !previews)
    if (files !== current.files) store.updateTask(id, (task) => ({ ...task, files }))
    return files
  } finally {
    if (scans.get(id) === scan) scans.delete(id)
  }
}
