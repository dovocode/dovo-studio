import type { WorkspaceStore } from '../../storage/workspace.js'
import type { GitService } from './git.js'
import { retainChangedFiles } from './retain-changes.js'

const pending = new WeakMap<WorkspaceStore, Map<string, symbol>>()

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
