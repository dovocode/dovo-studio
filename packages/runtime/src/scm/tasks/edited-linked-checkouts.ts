import type { LinkedCheckout, Task } from '@dovo/protocol'

/** Only an active edit link with saved file changes from this thread can own PR care. */
export function editedLinkedCheckouts(task: Task) {
  const links = new Map(
    task.linkedCheckouts?.filter((link) => link.access === 'edit').map((link) => [link.id, link]),
  )
  const edits: { checkout: LinkedCheckout; branch: string }[] = []
  const seen = new Set<string>()
  if (!links.size) return edits
  for (const turn of task.turns ?? []) {
    if (turn.checkpoint?.restorePending) continue
    for (const checkpoint of turn.checkpoint?.linked ?? []) {
      const checkout = links.get(checkpoint.checkoutId)
      if (
        !checkout ||
        checkout.repositoryId !== checkpoint.repositoryId ||
        (checkout.existingWorktreePath && checkout.existingWorktreePath !== checkpoint.directory) ||
        !checkpoint.branch ||
        !checkpoint.after ||
        checkpoint.before === checkpoint.after ||
        !checkpoint.files.length ||
        checkpoint.undone ||
        checkpoint.error
      )
        continue
      const key = JSON.stringify([checkout.id, checkpoint.branch])
      if (seen.has(key)) continue
      seen.add(key)
      edits.push({ checkout, branch: checkpoint.branch })
    }
  }
  return edits
}
