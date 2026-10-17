import { randomUUID, type DoChatCreateRequest } from '@dovo/protocol'

type ChatInput = Omit<DoChatCreateRequest, 'id'>

/** A lost create reply must not turn the user's next Send into a second conversation. */
export function doChatRequest(
  previous: DoChatCreateRequest | null,
  input: ChatInput,
): DoChatCreateRequest {
  if (
    previous &&
    previous.text === input.text &&
    previous.repositoryId === input.repositoryId &&
    previous.agentId === input.agentId
  )
    return previous
  return { ...input, id: randomUUID() }
}
