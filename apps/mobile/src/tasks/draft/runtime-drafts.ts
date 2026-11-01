import AsyncStorage from '@react-native-async-storage/async-storage'
import { runClientEffect } from '@dovo/client-runtime'
import { createDraftStorage } from './storage'
export const drafts = createDraftStorage(AsyncStorage)
export function saveRuntimeDraft(runtimeId: string, taskId: string, text: string) {
  return drafts.write(`dovo.draft.${encodeURIComponent(runtimeId)}.${taskId}`, text)
}
export function prepareRuntimeSideThread(
  runtimeId: string,
  taskId: string,
  childId: string,
  objective: string,
  initial: string,
  legacyDraftRuntimeId?: string | null,
) {
  return runClientEffect(
    drafts.prepareSideThreadEffect(
      `dovo.draft.${encodeURIComponent(runtimeId)}.${taskId}`,
      childId,
      objective,
      initial,
      runtimeId === legacyDraftRuntimeId ? `dovo.draft.${taskId}` : undefined,
    ),
  )
}
export function finishRuntimeSideThread(runtimeId: string, taskId: string, childId: string) {
  return runClientEffect(
    drafts.finishSideThreadEffect(`dovo.draft.${encodeURIComponent(runtimeId)}.${taskId}`, childId),
  )
}
/** Append through the same serialized store as the composer, including queued keyboard edits. */
export function appendRuntimeDraft(
  runtimeId: string,
  taskId: string,
  text: string,
  initialDraft = '',
  receiptId?: string,
  legacyDraftRuntimeId?: string | null,
) {
  return runClientEffect(
    drafts.appendEffect(
      `dovo.draft.${encodeURIComponent(runtimeId)}.${taskId}`,
      text,
      initialDraft,
      receiptId,
      runtimeId === legacyDraftRuntimeId ? `dovo.draft.${taskId}` : undefined,
    ),
  )
}
