import {
  decode,
  patchSchema,
  workspaceSchema,
  taskMetadataSchema,
  SCRATCH_PROJECT_ID,
  type WorkspacePatch,
  type WorkspacePatchResult,
} from '@dovo/protocol'
import type { Services } from '../../services.js'
import { HttpError } from '../../errors.js'
import { validateAutomation } from '../../jobs/validation.js'

/** Filesystem preparation is idempotent and stays outside SQLite transactions. */
export async function patchWorkspace(
  s: Services,
  input: unknown,
  deviceId: string,
  id?: string,
): Promise<WorkspacePatchResult> {
  const requested = decode(patchSchema, input)
  let preparationError: unknown
  try {
    const patch = s.store.previewPatch(requested)
    if (patch.collection === 'repositories' && patch.id === SCRATCH_PROJECT_ID) {
      if (!requested.create || Object.keys(requested.changes).length)
        throw new HttpError(400, 'The scratch workspace is managed by Dovo')
      await s.scratch.ensure()
    } else if (patch.collection === 'tasks') {
      const candidate =
        patch.create && typeof patch.create === 'object' && 'repositoryId' in patch.create
          ? patch.create.repositoryId
          : patch.changes.repositoryId?.after
      if (candidate === SCRATCH_PROJECT_ID) await s.scratch.ensure()
    }
  } catch (error) {
    preparationError = error
  }
  const run = () =>
    s.store.transaction(() => {
      if (preparationError) throw preparationError
      return apply(s, requested)
    })
  const settle = (
    reason: 'acknowledged' | 'interrupted' | 'rejected',
    error?: string,
  ): WorkspacePatchResult => {
    const host =
      s.store.get()[requested.collection].find((item) => item.id === requested.id) ?? null
    const message =
      reason === 'interrupted'
        ? 'The runtime retained its current state after an interrupted older edit.'
        : error
    const recoveryId =
      reason === 'acknowledged' ? undefined : s.store.preserveEdit(requested, host, message)
    return {
      revision: s.store.version(),
      runtimeInstanceId: s.instanceId,
      reconciled: true,
      outcome: reason === 'interrupted' ? 'reconciled' : reason,
      reason: message,
      recoveryId,
    }
  }
  const result = s.store.transaction(() =>
    id
      ? s.mutations.executeWorkspace(
          deviceId,
          id,
          { method: 'PATCH', path: '/api/workspace', input },
          run,
          settle,
        )
      : run(),
  )
  // A replay acknowledges the current runtime's cursor, even if the original
  // receipt was written before a restart. The operation's resolution stays intact.
  const value = { ...result, revision: s.store.version(), runtimeInstanceId: s.instanceId }
  if (requested.collection === 'repositories' && value.outcome !== 'rejected')
    s.approvals.applyWebRules()
  return value
}
function apply(s: Services, requested: WorkspacePatch): WorkspacePatchResult {
  const patch = s.store.previewPatch(requested)
  if (!(patch.collection === 'repositories' && patch.id === SCRATCH_PROJECT_ID)) {
    if (
      patch.collection === 'automations' &&
      (patch.changes.enabled?.after === true ||
        s.store.get().automations.find((item) => item.id === patch.id)?.enabled)
    ) {
      const current = s.store.get().automations.find((item) => item.id === patch.id)
      if (current)
        validateAutomation(
          decode(workspaceSchema.fields.automations.schema.value, {
            ...current,
            ...Object.fromEntries(
              Object.entries(patch.changes).map(([key, change]) => [
                key,
                change.after ?? undefined,
              ]),
            ),
          }),
          s.store.get(),
        )
    }
    if (
      patch.collection === 'tasks' &&
      (patch.create !== undefined || s.store.get().tasks.some((task) => task.id === patch.id))
    ) {
      const current = s.store.get().tasks.find((task) => task.id === patch.id)
      s.tasks.requireCheckoutReferencesAvailable(
        decode(taskMetadataSchema, {
          ...(patch.create ?? current),
          ...Object.fromEntries(
            Object.entries(patch.changes).map(([key, change]) => [key, change.after ?? undefined]),
          ),
        }),
      )
    }
    const { reconciled } = s.store.patch(requested)
    return {
      revision: s.store.version(),
      runtimeInstanceId: s.instanceId,
      reconciled,
      outcome: reconciled ? 'reconciled' : 'applied',
    }
  }
  return { revision: s.store.version(), runtimeInstanceId: s.instanceId, outcome: 'applied' }
}
