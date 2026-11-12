import { runtimeRecoveryScope, randomUUID, type RuntimeConnection } from '@dovo/protocol'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

/** A write-ahead record, retired only after the workspace outbox reaches the runtime. */
export function composerRecoveryKey(connection: RuntimeConnection | null, taskId: string) {
  return `dovo.composer-recovery.v1.${runtimeRecoveryScope(connection)}.${encodeURIComponent(taskId)}`
}
function record(key: string): { text: string | null; id: string; backup?: string } | null {
  const raw = localStorage.getItem(key)
  if (raw === null) return null
  const value: unknown = JSON.parse(raw)
  if (
    !value ||
    typeof value !== 'object' ||
    !('text' in value) ||
    (value.text !== null && typeof value.text !== 'string') ||
    !('id' in value) ||
    typeof value.id !== 'string'
  )
    throw new Error('Saved composer recovery data is invalid. It was preserved.')
  if ('backup' in value && typeof value.backup !== 'string')
    throw new Error('Saved composer recovery data is invalid. It was preserved.')
  return {
    text: value.text,
    id: value.id,
    ...('backup' in value && typeof value.backup === 'string' ? { backup: value.backup } : {}),
  }
}
export function createComposerRecovery(key: string) {
  const initial = record(key)
  let owned = initial?.id ?? null
  return {
    text: initial?.text ?? null,
    backup: initial?.backup ?? '',
    protect(this: void, text: string, expected?: string) {
      // A remounted composer may have edited even the same text. Compare record identity.
      if (expected !== undefined && (record(key)?.id ?? null) !== owned) return false
      const id = randomUUID()
      localStorage.setItem(key, JSON.stringify({ text, id }))
      owned = id
      return true
    },
    discardBackup(this: void) {
      const current = record(key)
      if (current?.id === owned && current.text === null)
        localStorage.setItem(key, JSON.stringify({ text: null, id: owned, backup: '' }))
    },
    checkpoint(this: void) {
      return owned
    },
    retire(this: void, checkpoint: string | null) {
      // Keep a small revision marker after sync, so a stale acknowledgement cannot clear
      // identical text written by a newer composer. Synced text is no longer replayed.
      const current = record(key)
      if (checkpoint !== null && current?.id === checkpoint)
        localStorage.setItem(
          key,
          JSON.stringify({
            text: null,
            id: checkpoint,
            backup: current.text ?? current.backup ?? '',
          }),
        )
    },
  }
}

/** Caret records must include the thread without exposing a credential-bearing scope string. */
export function composerCaretRecoveryKey(scope: string | undefined, taskId: string) {
  return `dovo.composer-caret.v1.${bytesToHex(sha256(utf8ToBytes(JSON.stringify([scope ?? '', taskId]))))}`
}
