import { decode, doChatCreateRequestSchema, type DoChatCreateRequest } from '@dovo/protocol'

export type DoChatDraft = Omit<DoChatCreateRequest, 'id'>
export type DoChatAttempt = { runtimeId: string; input: DoChatCreateRequest }

/** A lost create reply must retry the same request, even after switching computers and back. */
export function doChatAttempt(
  previous: DoChatAttempt | null,
  runtimeId: string,
  draft: DoChatDraft,
  createId: () => string,
): DoChatAttempt {
  if (
    previous?.runtimeId === runtimeId &&
    previous.input.text === draft.text &&
    previous.input.agentId === draft.agentId &&
    previous.input.repositoryId === draft.repositoryId
  )
    return previous
  return {
    runtimeId,
    input: decode(doChatCreateRequestSchema, { id: createId(), ...draft }),
  }
}
