import type { DeleteIdentity } from './delete-identity.js'
import type { AccountStore } from './store.js'

/** Deletes the Auth identity, then the Connect account. Both steps are safe to repeat. */
export async function finishDeletion(
  store: AccountStore,
  deleteIdentity: DeleteIdentity,
  user: string,
) {
  if (!store.organizationIdentity(user)) {
    store.attemptDeletion(user)
    await deleteIdentity(user, {
      verified: store.deletionVerified(user),
      verify: () => store.verifyDeletion(user),
    })
  }
  store.deleteAccount(user)
}

/**
 * Finishes deletions that started while Auth was unavailable. Connect keeps the subject in
 * its own store, so a deletion completes after a restart or after the user's session expires.
 */
export function pendingDeletions(store: AccountStore, deleteIdentity: DeleteIdentity) {
  let running: Promise<void> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let stopped = false
  const pass = async () => {
    try {
      for (const user of store.pendingDeletions()) {
        if (stopped) return
        if (store.deletionPending(user)) await finishDeletion(store, deleteIdentity, user)
      }
    } catch {
      // Auth is most likely unavailable. The pending row records the work, so stop here and
      // send at most one failing request per pass. The next pass starts with the least
      // recently attempted account, so one failing account cannot block the others.
    }
  }
  const run = () => {
    if (stopped || running) return
    running = pass().finally(() => {
      running = undefined
    })
  }
  return {
    start() {
      if (stopped || timer) return
      run()
      timer = setInterval(run, 60_000)
      timer.unref()
    },
    /** Stops new attempts and waits for an attempt in progress, so the store can close. */
    async stop() {
      stopped = true
      clearInterval(timer)
      await running
    },
  }
}
