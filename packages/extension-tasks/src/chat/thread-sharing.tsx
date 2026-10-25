import { ThreadSuggestions } from './thread-suggestions'
import { useState } from 'react'
import { Share2 } from 'lucide-react'
import {
  useAccount,
  useAppPreferences,
  useStudioHost,
  useWorkspace,
  sharedContentSchema,
  sharingStatusSchema,
} from '@dovo/studio-core'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'
import type { AccountStorage, SharingWriterConfig } from '@dovo/protocol'
import { SharingPanel } from './sharing-panel'

export function ThreadSharing({ taskId, title }: { taskId: string; title: string }) {
  const host = useStudioHost(),
    [open, setOpen] = useState(false)
  if (!host.accountStorage || !host.openExternalLink) return null
  return (
    <>
      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setOpen(true)}>
        <Share2 className="size-3.5" />
        Share thread
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogTitle>Share thread</DialogTitle>
          <DialogDescription>Choose who can access “{title}”.</DialogDescription>
          {open && (
            <Content taskId={taskId} storage={host.accountStorage} open={host.openExternalLink} />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
function Content({
  taskId,
  storage,
  open,
}: {
  taskId: string
  storage: AccountStorage
  open: (url: string) => Promise<void>
}) {
  const account = useAccount(storage, open, useAppPreferences()),
    { request, connected, activeRuntimeId } = useWorkspace()
  const runtime = {
    taskId,
    preview: () => request('/api/sharing/preview', { taskId }, sharedContentSchema),
    enable: (config: SharingWriterConfig) =>
      request('/api/sharing/enable', config, sharingStatusSchema),
    status: (id: string) => request('/api/sharing/status', { taskId, id }, sharingStatusSchema),
    stop: (id: string) => request('/api/sharing/stop', { taskId, id }, sharingStatusSchema),
  }
  return (
    <SharingPanel
      key={`${account.client.sessionId()}:${activeRuntimeId}:${taskId}`}
      client={account.client}
      sourceId={`${activeRuntimeId}:${taskId}`}
      kind="thread"
      runtime={connected ? runtime : undefined}
    />
  )
}

export function InlineThreadSuggestions(props: {
  taskId: string
  active: boolean
  onUseSuggestion: (text: string) => void
}) {
  const host = useStudioHost()
  if (!host.accountStorage || !host.openExternalLink) return null
  return <InlineContent {...props} storage={host.accountStorage} open={host.openExternalLink} />
}
function InlineContent({
  taskId,
  active,
  onUseSuggestion,
  storage,
  open,
}: {
  taskId: string
  active: boolean
  onUseSuggestion: (text: string) => void
  storage: AccountStorage
  open: (url: string) => Promise<void>
}) {
  const account = useAccount(storage, open, useAppPreferences())
  const { activeRuntimeId } = useWorkspace()
  return (
    <ThreadSuggestions
      client={account.client}
      sourceId={`${activeRuntimeId}:${taskId}`}
      active={active}
      onUseSuggestion={onUseSuggestion}
    />
  )
}
