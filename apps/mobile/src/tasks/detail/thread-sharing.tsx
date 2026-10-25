import { ThreadSuggestions } from '../../ui/content/thread-suggestions'
import { useRuntime } from '../../runtime/connection/provider'
import { useMobileAccount } from '../../runtime/connection/account-provider'
import { useTaskConversation } from '../conversation/state/provider'
import { sharedContentSchema, sharingStatusSchema } from '@dovo/studio-core'
import type { SharingWriterConfig } from '@dovo/protocol'
import { Sheet } from '../../ui/layout/sheet'
import { SharingPanel } from '../../ui/content/sharing-panel'

export function ThreadSharing({ onClose }: { onClose: () => void }) {
  const { task, actions } = useTaskConversation()
  const { call, activeId, connected } = useRuntime(),
    account = useMobileAccount()
  const runtime = {
    taskId: task.id,
    preview: () => call('/api/sharing/preview', { taskId: task.id }, sharedContentSchema),
    enable: (config: SharingWriterConfig) =>
      call('/api/sharing/enable', config, sharingStatusSchema),
    status: (id: string) =>
      call('/api/sharing/status', { taskId: task.id, id }, sharingStatusSchema),
    stop: (id: string) => call('/api/sharing/stop', { taskId: task.id, id }, sharingStatusSchema),
  }
  if (task.example) return null
  return (
    <Sheet title="Share thread" onClose={onClose}>
      <SharingPanel
        key={`${account.client.sessionId()}:${activeId}:${task.id}`}
        sourceId={`${activeId}:${task.id}`}
        kind="thread"
        runtime={connected ? runtime : undefined}
        onUseSuggestion={(text) => {
          actions.draft.update([actions.draft.text, text].filter(Boolean).join('\n\n'))
          onClose()
        }}
      />
    </Sheet>
  )
}

export function InlineThreadSuggestions() {
  const { task, actions, visible } = useTaskConversation()
  const { activeId } = useRuntime()
  const account = useMobileAccount()
  if (task.example) return null
  return (
    <ThreadSuggestions
      client={account.client}
      sourceId={`${activeId}:${task.id}`}
      active={visible}
      onUseSuggestion={(text) =>
        actions.draft.update([actions.draft.text, text].filter(Boolean).join('\n\n'))
      }
    />
  )
}
