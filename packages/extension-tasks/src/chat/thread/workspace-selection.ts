import type { useWorkspace } from '@dovo/studio-core'

export const selectConversationConnection = (value: ReturnType<typeof useWorkspace>) => ({
  connection: value.connection,
  request: value.request,
  connected: value.connected,
  activeRuntimeId: value.activeRuntimeId,
})
